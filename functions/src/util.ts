import fs from 'fs'
import axios from 'axios'
import {parseISO} from 'date-fns'
import {getStorage} from 'firebase-admin/storage'
import path from 'path'

const fileExists = (filePath: string): Promise<boolean> => fs.promises.access(filePath).then(() => true, () => false)

const mkdirWriteFile = (localPath: string, contents: string) =>
        fs.promises.mkdir(path.dirname(localPath), {recursive: true})
        .then( () => fs.promises.writeFile(localPath, contents) )

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
    store(path: string, text: string): Promise<void>
}

async function downloadFile(url: string, accessToken: string | undefined) {
    console.log('Downloading', url)
    const options = accessToken ? {headers: { Authorization: `Bearer ${accessToken}`}} : {}
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

export async function putIntoCacheAndFile(cachePath: string, localPath: string, cache: ModuleCache, contents: string) {
    await Promise.all([
        mkdirWriteFile(localPath, contents),
        cache.store(cachePath, contents)
    ])
}

export class CloudStorageCache implements ModuleCache {
    constructor(private readonly bucketName?: string) {
    }

    downloadToFile(path: string, localFilePath: string): Promise<boolean> {
        return getStorage().bucket(this.bucketName).file(this.cachePath(path)).download({destination: localFilePath}).then( () => true, () => false )
    }

    store(path: string, text: string): Promise<void> {
        return getStorage().bucket(this.bucketName).file(this.cachePath(path)).save(text)
    }

    private cachePath(path: string) {
        return 'moduleCache' + '/' + path.replace(/^https?:\/\//, '')
    }
}
