import fs from 'fs'
import axios, {type ResponseType} from 'axios'
import {parseISO} from 'date-fns'
import {getStorage} from 'firebase-admin/storage'
import path from 'path'

const fileExists = (filePath: string): Promise<boolean> => fs.promises.access(filePath).then(() => true, () => false)

const mkdirWriteFile = (localPath: string, contents: Buffer) =>
        fs.promises.mkdir(path.dirname(localPath), {recursive: true})
        .then( () => fs.promises.writeFile(localPath, contents) )

const rmdir = (localPath: string) => fs.promises.rm(localPath, {recursive: true, force: true})
const isNumeric = (s: string) : boolean => s!== '' && s.match(/^\d*\.?\d*$/) !== null
const isBooleanString = (s: string) : boolean => s.match(/true|false/) !== null

export const parseParam = (param: string) => {
    if (isNumeric(param)) {
        return parseFloat(param)
    }

    if (isBooleanString(param)) {
        return param === true.toString()
    }

    const date = parseISO(param)
    if (!Number.isNaN(date.getTime())) {
        return date
    }

    return param
}

export interface ModuleCache {
    downloadToFile(path: string, localFilePath: string): Promise<boolean>
    store(path: string, contents: Buffer): Promise<void>
    clear(): Promise<void>
}

async function downloadFile(url: string, accessToken: string | undefined): Promise<Buffer> {
    console.log('Downloading', url)
    const responseType = 'arraybuffer' as ResponseType
    const headers = accessToken ? {headers: { Authorization: `Bearer ${accessToken}`}} : {}
    const options = {responseType, ...headers}
    const resp = await axios.get(url, options)
    if (resp.status !== 200) {
        throw new Error(resp.status + ' ' + resp.statusText)
    }
    return await resp.data
}

export async function downloadModule(url: string, localPath: string, cache: ModuleCache, accessToken?: string) {
    const alreadyDownloaded = await fileExists(localPath)
    if (!alreadyDownloaded) {
        console.log('Fetching from cache', url)
        const foundInCache = await cache.downloadToFile(url, localPath)
        if (!foundInCache) {
            const moduleContents = await downloadFile(url, accessToken)
            await cache.store(url, moduleContents)
            await mkdirWriteFile(localPath, moduleContents)
        }
    }
}

export async function getFromCache(cachePath: string, localPath: string, cache: ModuleCache) {
    const alreadyDownloaded = await fileExists(localPath)
    if (!alreadyDownloaded) {
        console.log('Fetching from cache', cachePath)
        const foundInCache = await cache.downloadToFile(cachePath, localPath)
        if (!foundInCache) {
            throw new Error('File not found in cache: ' + cachePath)
        }
    }
}

export function cachePath(username: string, repo: string, commitId: string, filePath: string) {
    return [username, repo, commitId, filePath.replace(/^\//, '')].join('/')
}

export async function putIntoCacheAndFile(cachePath: string, localPath: string, cache: ModuleCache, contents: Buffer) {
    await Promise.all([
        mkdirWriteFile(localPath, contents),
        cache.store(cachePath, contents)
    ])
}

export function clearCache(localPath: string, cache: ModuleCache) {
    return Promise.all([rmdir(localPath), cache.clear()])
}

export class CloudStorageCache implements ModuleCache {
    constructor(private readonly bucketName?: string) {
    }

    downloadToFile(path: string, localFilePath: string): Promise<boolean> {
        return getStorage().bucket(this.bucketName).file(this.cachePath(path)).download({destination: localFilePath}).then( () => true, () => false )
    }

    store(path: string, contents: Buffer): Promise<void> {
        return getStorage().bucket(this.bucketName).file(this.cachePath(path)).save(contents)
    }

    async clear(): Promise<void> {
        let bucket = getStorage().bucket(this.bucketName)
        const [cacheFiles] = await bucket.getFiles({prefix: this.cachePath('')})
        await Promise.all(cacheFiles.map( f => bucket.file(f.name).delete()))
    }

    private cachePath(path: string) {
        return 'deployCache' + '/' + path.replace(/^https?:\/\//, '')
    }
}
