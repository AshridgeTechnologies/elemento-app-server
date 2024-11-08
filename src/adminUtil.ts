import axios from 'axios'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node/index.js'
import {gzipSync} from 'fflate'

import fs from 'fs'
import crypto from 'crypto'
import {bufferFromJson, fileExists, googleApiRequest, runtimeImportPath} from './util.js'
import path from 'path'
import {ModuleCache} from './CloudStorageCache.js'
import {env} from 'process'

const ASSET_DIR = 'files'
const firebaseRootUrl = `https://firebase.googleapis.com/v1beta1`
const hostingRootUrl = `https://firebasehosting.googleapis.com/v1beta1`

export const defaultRegion = 'europe-west2'

export type ProjectSettings = {
    previewPassword: string
}

export const wait = (time: number): Promise<void> => new Promise(resolve => setTimeout(resolve, time))

const hostingRequest = (path: string, accessToken: string, method: string = 'GET', data?: object) => googleApiRequest(hostingRootUrl, path, accessToken, method, data)
const firebaseRequest = (path: string, accessToken: string, method: string = 'GET', data?: object) => googleApiRequest(firebaseRootUrl, path, accessToken, method, data)

async function uploadFile(uploadUrl: string, filePath: string, hash: string, data: BufferSource, accessToken: string) {
    const options = {
        url: uploadUrl + '/' + hash,
        method:  'POST',
        headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type':  'application/octet-stream',
        },
        data,
    }

    const resp = await axios.request(options)
    if (resp.status !== 200) {
        const {message} = (resp as any).result.error
        throw new Error(`Error deploying to Firebase Hosting: ${message}`)
    }
}

async function hashData(data: BufferSource) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

const cloneRepo = (url: string, username: string | undefined, accessToken: string, dir: string) => {
    return git.clone({
        fs,
        http,
        dir,
        url,
        singleBranch: true,
        depth: 1,
        onAuth: () => ({username, password: accessToken}),
    })
}

const getLatestCommitId = async (dir: string) => {
    const commits = await git.log({
        fs,
        dir,
        depth: 1,
    })
    return commits[0].oid
}

const allFilePaths = (dir: string) => fs.promises.readdir(dir, {recursive: true, withFileTypes: true})
    .then(files => files.filter(f => f.isFile()).map(f => `${f.path}/${f.name}`))

const files =  async (dir: string): Promise<{[path: string] : {filePath: string, hash: string, gzip: Uint8Array}}> => {
    const filePaths = await allFilePaths(dir)
    console.log('files to deploy', filePaths)
    const hashAndZip = async (fullFilePath: string) => {
        const fileBuffer = await fs.promises.readFile(fullFilePath)
        const fileData = new Uint8Array(fileBuffer)
        const gzip = gzipSync(fileData)
        const hash = await hashData(gzip)
        const filePath = fullFilePath.replace(dir, '')
        return {filePath, gzip, hash}
    }

    const fileEntryPromises = filePaths.map(hashAndZip)
    const fullFileEntries = await Promise.all(fileEntryPromises)
    return Object.fromEntries(fullFileEntries.map( f => [f.filePath, f]))
}

async function deployServerFiles({gitRepoUrl, commitId, deployTime, checkoutPath, moduleCache}:
                                     {gitRepoUrl: string, commitId: string, deployTime: string, checkoutPath: string, moduleCache: ModuleCache, firebaseAccessToken: string}) {
    const storeInCache = async (pathInCache: string, fileBuffer: Buffer) => {
        console.log('Storing in cache', pathInCache)
        await moduleCache.store(pathInCache, fileBuffer)
    }

    const versionInfo = JSON.stringify({gitRepoUrl, commitId, deployTime})

    await storeInCache(path.join(commitId, 'versionInfo'), Buffer.from(versionInfo, 'utf8'))
    const distPath = `${checkoutPath}/dist`
    const serverDirPath = `${distPath}/server`
    if (!(await fileExists(serverDirPath))) {
        return false
    }

    const serverFilePaths = await allFilePaths(serverDirPath)

    const storeFile = async (filePath: string) => {
        const fileBuffer = await fs.promises.readFile(filePath)
        const relativeFilePath = filePath.replace(distPath, '')
        await storeInCache(`${commitId}${relativeFilePath}`, fileBuffer)
    }

    const storeRuntime = async () => {
        const fileBuffer: Buffer = await axios.get(`${runtimeImportPath}/serverRuntime.cjs`, {responseType: 'arraybuffer'}).then( resp => resp.data )
        await storeInCache(`${commitId}/server/serverRuntime.cjs`, fileBuffer)
    }

    await Promise.all([storeRuntime(), ...serverFilePaths.map(storeFile)])
    return true
}

async function getFirebaseConfig(firebaseProject: string, firebaseAccessToken: string) {
    let {apps} = await firebaseRequest(`projects/${firebaseProject}/webApps`, firebaseAccessToken)
    let app
    if (apps?.length > 0) {
        app = apps[0]
    } else {
        const {name: operationName} = await firebaseRequest(`projects/${firebaseProject}/webApps`, firebaseAccessToken, 'POST')
        let operation = {done: false} as any
        let tries = 0, maxTries = 10
        while (!operation.done && ++tries <= maxTries) {
            await wait(750)
            operation = await firebaseRequest(operationName, firebaseAccessToken)
        }
        if (tries > maxTries) {
            throw new Error("Timed out creating web app")
        }
        if (operation.error) {
            throw new Error(operation.error)
        }

        app = operation.response
    }

    return await firebaseRequest(`projects/${firebaseProject}/webApps/${app.appId}/config`, firebaseAccessToken)
}

export async function getOverview({settingsStore}: {settingsStore: ModuleCache}) {
    const firebaseConfigFound = await settingsStore.exists('firebaseConfig.json')
    const statusResult = `Firebase config ${firebaseConfigFound ? 'OK' : 'not found'}`
    const services = `Services available: ${servicesAvailable}`
    return `<h1>Elemento App Server</h1>
<div>${statusResult}</div>
<div>${services}</div>
`
}

export async function setupProject({firebaseProject, firebaseAccessToken, settingsStore, settings}: {
    firebaseProject: string,
    firebaseAccessToken: string,
    settingsStore: ModuleCache,
    settings: ProjectSettings
}) {
    const config = await getFirebaseConfig(firebaseProject, firebaseAccessToken)
    await settingsStore.store('firebaseConfig.json', bufferFromJson(config))
    await settingsStore.store('.settings.json', bufferFromJson(settings))
}

const serverAppRewrites = (region: string) => ([
    {
        glob: '/@(capi|admin|preview|install)/**',
        run: {
            serviceId: 'elemento-app-server',
            region
        }
    }
] as any[])
const usernameOf = (url: string) => new URL(url).pathname.substring(1).split('/')[0]

export async function deployToHosting({gitRepoUrl, username = usernameOf(gitRepoUrl), firebaseProject, checkoutPath, firebaseAccessToken, gitHubAccessToken, moduleCache}:
                                          {gitRepoUrl: string, firebaseProject: string, checkoutPath: string,
                                              firebaseAccessToken: string, username?: string, gitHubAccessToken: string, moduleCache: ModuleCache}) {

    console.log('Starting deploy to hosting')
    const {sites} = await hostingRequest(`projects/${firebaseProject}/sites`, firebaseAccessToken)
    console.log('sites', sites)
    const config = await getFirebaseConfig(firebaseProject, firebaseAccessToken)
    console.log('config', config)

    const site = sites.find((s: any) => s.type === 'DEFAULT_SITE')
    const siteName = site.name.match(/[^/]+$/)[0]
    const version = await hostingRequest(`sites/${siteName}/versions`, firebaseAccessToken, 'POST')
    console.log('version', version)

    await cloneRepo(gitRepoUrl, username, gitHubAccessToken, checkoutPath)
    console.log('checked out files', await fs.promises.readdir(checkoutPath))

    const commitId = (await getLatestCommitId(checkoutPath)).substring(0, 12)

    const deployTime = new Date().toISOString()
    const versionData = {deployTime, commitId}
    console.log('commit id', commitId, 'deployTime', deployTime)

    const distDirPath = `${checkoutPath}/dist`
    const clientDirPath = `${distDirPath}/client`
    await fs.promises.writeFile(`${clientDirPath}/version`, JSON.stringify(versionData, null, 2), 'utf8')
    await fs.promises.writeFile(`${clientDirPath}/firebaseConfig.json`, JSON.stringify(config, null, 2), 'utf8')

    const hostingFiles = await files(clientDirPath)
    console.log('files to deploy to hosting', Object.keys(hostingFiles))

    const filesToPopulate = Object.fromEntries(Object.entries(hostingFiles).map( ([path, {hash}]) => [path, hash]))
    const populateFilesResult = await hostingRequest(`${version.name}:populateFiles`, firebaseAccessToken, 'POST', {files: filesToPopulate})
    console.log('populateFilesResult', populateFilesResult)

    const {uploadUrl, uploadRequiredHashes} = populateFilesResult
    console.log('uploadUrl', uploadUrl, 'hashes', uploadRequiredHashes)

    const uploadPromises = uploadRequiredHashes.map( async (hash: string) => {
        const file = Object.values(hostingFiles).find(f => f.hash === hash)
        const {filePath, gzip} = file!
        try {
            await uploadFile(uploadUrl, filePath, hash, gzip, firebaseAccessToken)
            console.log('Uploaded', filePath)
        } catch (err) {
            console.error('Failed to upload', filePath, err)
            throw err
        }
    })

    await Promise.all(uploadPromises)

    await deployServerFiles({gitRepoUrl, checkoutPath, commitId, deployTime, moduleCache, firebaseAccessToken})

    const serverRewrites = serverAppRewrites(defaultRegion)
    const appDirs = await fs.promises.readdir(clientDirPath, {withFileTypes: true})
        .then( files => files.filter( f => f.isDirectory() && f.name !== ASSET_DIR).map( f => f.name ) )
    const spaRewrites = appDirs.map( dir =>  ({glob: `/${dir}/**`, path: `/${dir}/index.html`}))
    const projectInfoFilePath = `${distDirPath}/projectInfo.json`

    const getDefaultAppRedirects = async () => {
        if (await fileExists(projectInfoFilePath)) {
            const projectInfo = JSON.parse(await fs.promises.readFile(projectInfoFilePath, 'utf8'))
            const defaultAppDir = projectInfo.apps?.[0]
            if (defaultAppDir) {
                return [{glob: `/`, statusCode: 301, location: `/${defaultAppDir}`}]
            }
        }
        return []
    }
    const defaultAppRedirects = await getDefaultAppRedirects()
    const rewrites = [...serverRewrites, ...spaRewrites]
    const redirects = [...defaultAppRedirects]
    const headers = [
            {
                glob: "**/**",
                headers: {
                    "Cache-Control": "public,max-age=0,must-revalidate"
                }
            }]

    const urlConfig = {
        trailingSlashBehavior: "REMOVE"
    }
    const hostingConfig = {
        rewrites,
        redirects,
        headers,
        ...urlConfig
    }

    console.log('hostingConfig', JSON.stringify(hostingConfig))

    const patchResult = await hostingRequest(`${version.name}?update_mask=status,config`, firebaseAccessToken, 'PATCH',
        {
            status: 'FINALIZED',
            config: hostingConfig
        })

    console.log('patch', patchResult)

    const releaseResult = await hostingRequest(`sites/${siteName}/releases?versionName=${version.name}`, firebaseAccessToken, 'POST')
    console.log('release', releaseResult)
    return releaseResult
}

async function getExistingAppRewrites(siteName: string, firebaseAccessToken: string): Promise<any[]> {
    console.log('Getting current hosting config')
    const {releases} = await hostingRequest(`sites/${siteName}/channels/live/releases?pageSize=1`, firebaseAccessToken)
    console.log('releases', releases)
    const latestRelease = releases[0]
    const existingRewrites = latestRelease?.version?.config?.rewrites
    if (!existingRewrites) return []

    return existingRewrites.filter( (rewrite: any) => rewrite.path )
}

export async function deployRewritesOnlyToHosting({firebaseProject, region, firebaseAccessToken}: {firebaseProject: string, region: string, firebaseAccessToken: string}) {

    console.log('Starting deploy rewrites to hosting')
    const {sites} = await hostingRequest(`projects/${firebaseProject}/sites`, firebaseAccessToken)
    console.log('sites', sites)

    const site = sites.find((s: any) => s.type === 'DEFAULT_SITE')
    const siteName = site.name.match(/[^/]+$/)[0]

    const appRewrites = await getExistingAppRewrites(siteName, firebaseAccessToken)
    const version = await hostingRequest(`sites/${siteName}/versions`, firebaseAccessToken, 'POST')
    console.log('version', version)

    const hostingConfig = {
        rewrites: [...serverAppRewrites(region), ...appRewrites]
    }

    console.log('hostingConfig for rewrites only', JSON.stringify(hostingConfig))

    //TODO - possible race condition here - following call fails intermittently with 404, although should exist when previous call returns
    // Could just wait, or get the version until can find it, or retry the request after 5s if it fails
    const patchResult = await hostingRequest(`${version.name}?update_mask=status,config`, firebaseAccessToken, 'PATCH',
        {
            status: 'FINALIZED',
            config: hostingConfig
        })

    console.log('patch', patchResult)

    const releaseResult = await hostingRequest(`sites/${siteName}/releases?versionName=${version.name}`, firebaseAccessToken, 'POST')
    console.log('release', releaseResult)
    return releaseResult
}

export const defaultServices = 'app, admin, preview, install'
export const servicesAvailable = (env.SERVICES_AVAILABLE ?? defaultServices).toLowerCase()