import axios, {ResponseType} from 'axios'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node/index.js'
import {gzipSync} from 'fflate'

import fs from 'fs'
import crypto from 'crypto'



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

const files =  async (dir: string): Promise<{[path: string] : {filePath: string, hash: string, gzip: Uint8Array}}> => {
    const files = await fs.promises.readdir(dir, {recursive: true, withFileTypes: true})
        .then( files => files.filter( f => f.isFile() ).map( f => `${f.path}/${f.name}` ) )
    console.log('files to deploy', files)
    const hashAndZip = async (fullFilePath: string) => {
        const fileBuffer = await fs.promises.readFile(fullFilePath)
        const fileData = new Uint8Array(fileBuffer)
        const gzip = gzipSync(fileData)
        const hash = await hashData(gzip)
        const filePath = fullFilePath.replace(dir, '')
        return {filePath, gzip, hash}
    }

    const fileEntryPromises = files.map(hashAndZip)
    const fullFileEntries = await Promise.all(fileEntryPromises)
    return Object.fromEntries(fullFileEntries.map( f => [f.filePath, f]))
}

export async function deployToHosting({username, repo, firebaseProject, checkoutPath, firebaseAccessToken, gitHubAccessToken}:
                                          {username: string, repo: string, firebaseProject: string, checkoutPath: string,
                                              firebaseAccessToken: string, gitHubAccessToken: string}) {

    const {sites} = await hostingRequest(`projects/${firebaseProject}/sites`, firebaseAccessToken)
    console.log('sites', sites)

    const site = sites.find((s: any) => s.type === 'DEFAULT_SITE')
    const siteName = site.name.match(/[^/]+$/)[0]
    const version = await hostingRequest(`sites/${siteName}/versions`, firebaseAccessToken, 'POST')
    console.log('version', version)

    await cloneRepo(username, repo, gitHubAccessToken, checkoutPath)
    console.log('checked out files', await fs.promises.readdir(checkoutPath))

    const metadata = {
        deployTime: new Date().toISOString(),
        commitId: await getLatestCommitId(checkoutPath)
    }
    const deployPath = `${checkoutPath}/dist/client`
    await fs.promises.writeFile(`${deployPath}/version`, JSON.stringify(metadata, null, 2), 'utf8')
    const filesToDeploy = await files(deployPath)
    console.log('files to deploy', Object.keys(filesToDeploy))

    const filesToPopulate = Object.fromEntries(Object.entries(filesToDeploy).map( ([path, {hash}]) => [path, hash]))
    const populateFilesResult = await hostingRequest(`${version.name}:populateFiles`, firebaseAccessToken, 'POST', {files: filesToPopulate})
    console.log('populateFilesResult', populateFilesResult)

    const {uploadUrl, uploadRequiredHashes} = populateFilesResult
    console.log('uploadUrl', uploadUrl, 'hashes', uploadRequiredHashes)

    const uploadPromises = uploadRequiredHashes.map( async (hash: string) => {
        const file = Object.values(filesToDeploy).find(f => f.hash === hash)
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

    // const serverAppName = this.serverApp?.codeName?.toLowerCase()
    const serverAppRewrites = /*serverAppName ? [{
        glob: `/${serverAppName}/!**`,
        run: {serviceId: 'serverapp1', region: 'europe-west2'}}
    ] :*/ [] as any
    const spaRewrite = {glob: '**', path: '/index.html'}
    const patchResult = await hostingRequest(`${version.name}?update_mask=status,config`, firebaseAccessToken, 'PATCH',
        {
            status: 'FINALIZED',
            config: {
                rewrites: [...serverAppRewrites, spaRewrite,]
            }
        })

    console.log('patch', patchResult)

    const releaseResult = await hostingRequest(`sites/${siteName}/releases?versionName=${version.name}`, firebaseAccessToken, 'POST')
    console.log('release', releaseResult)
    return releaseResult
}