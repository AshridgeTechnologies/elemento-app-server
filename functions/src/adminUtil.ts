import axios, {ResponseType} from 'axios'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node/index.js'
import {gzipSync} from 'fflate'

import fs from 'fs'
import crypto from 'crypto'
import {ModuleCache} from './util'
import path from 'path'


const ASSET_DIR = 'files'
const rootUrl = `https://firebasehosting.googleapis.com/v1beta1`

async function hostingRequest(path: string, accessToken: string, method: string = 'GET', data?: object) {
    const url = `${rootUrl}/${path}`
    const responseType = 'json' as ResponseType
    const headers = accessToken ? {headers: {Authorization: `Bearer ${accessToken}`}} : {}
    const options = {url, method, responseType, data, ...headers}
    const resp = await axios.request(options)
    if (resp.status !== 200) {
        const {message} = (resp as any).result.error
        throw new Error(`Error deploying to Firebase Hosting: ${message}`)
    }
    return await resp.data
}

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

const cloneRepo = (username: string, repo: string, accessToken: string, dir: string) => {
    const url = `https://github.com/${username}/${repo}`
    return git.clone({
        fs,
        http,
        dir,
        url,
        singleBranch: true,
        depth: 1,
        onAuth: () => ({username: username, password: accessToken}),
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

const exists = (path: string) => fs.promises.stat(path).then( ()=> true, ()=> false)

async function deployServerFiles({username, repo, commitId, deployTime, checkoutPath, moduleCache}:
                                     {username: string, repo: string, commitId: string, deployTime: string, checkoutPath: string, moduleCache: ModuleCache}) {
    const versionInfo = JSON.stringify({username, repo, commitId, deployTime})
    await moduleCache.store(path.join(commitId, 'versionInfo'), Buffer.from(versionInfo, 'utf8'))

    const distPath = `${checkoutPath}/dist`
    const serverDirPath = `${distPath}/server`
    if (!(await exists(serverDirPath))) {
        return false
    }
    const serverFilePaths = await allFilePaths(serverDirPath)
    const storeFile = async (filePath: string) => {
        const fileBuffer = await fs.promises.readFile(filePath)
        const relativeFilePath = filePath.replace(distPath, '')
        const pathInCache = path.join(commitId, relativeFilePath)
        console.log('Storing in cache', pathInCache)
        return moduleCache.store(pathInCache, fileBuffer)
    }

    await Promise.all(serverFilePaths.map(storeFile))
    return true
}

export async function deployToHosting({username, repo, firebaseProject, checkoutPath, firebaseAccessToken, gitHubAccessToken, moduleCache}:
                                          {username: string, repo: string, firebaseProject: string, checkoutPath: string,
                                              firebaseAccessToken: string, gitHubAccessToken: string, moduleCache: ModuleCache}) {

    const {sites} = await hostingRequest(`projects/${firebaseProject}/sites`, firebaseAccessToken)
    console.log('sites', sites)

    const site = sites.find((s: any) => s.type === 'DEFAULT_SITE')
    const siteName = site.name.match(/[^/]+$/)[0]
    const version = await hostingRequest(`sites/${siteName}/versions`, firebaseAccessToken, 'POST')
    console.log('version', version)

    await cloneRepo(username, repo, gitHubAccessToken, checkoutPath)
    console.log('checked out files', await fs.promises.readdir(checkoutPath))

    const commitId = (await getLatestCommitId(checkoutPath)).substring(0, 12)
    const deployTime = new Date().toISOString()
    const versionData = {deployTime, commitId}
    const clientDirPath = `${checkoutPath}/dist/client`
    await fs.promises.writeFile(`${clientDirPath}/version`, JSON.stringify(versionData, null, 2), 'utf8')
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

    await deployServerFiles({username, repo, checkoutPath, commitId, deployTime, moduleCache})

    const serverAppRewrites = [
        // {glob: `/capi/**`, run: {serviceId: 'serverapp1', region: 'europe-west2'}}
    ] as any[]
    const appDirs = await fs.promises.readdir(clientDirPath, {withFileTypes: true})
        .then( files => files.filter( f => f.isDirectory() && f.name !== ASSET_DIR).map( f => f.name ) )
    const spaRewrites = appDirs.map( dir =>  ({glob: `/${dir}/**`, path: `/${dir}/index.html`}))
    const patchResult = await hostingRequest(`${version.name}?update_mask=status,config`, firebaseAccessToken, 'PATCH',
        {
            status: 'FINALIZED',
            config: {
                rewrites: [...serverAppRewrites, ...spaRewrites,]
            }
        })

    console.log('patch', patchResult)

    const releaseResult = await hostingRequest(`sites/${siteName}/releases?versionName=${version.name}`, firebaseAccessToken, 'POST')
    console.log('release', releaseResult)
    return releaseResult
}