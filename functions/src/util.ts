import fs from 'fs'
import {parseISO} from 'date-fns'
import {getStorage} from 'firebase-admin/storage'
import path from 'path'
import axios, {HttpStatusCode} from 'axios'

export const runtimeImportPath = 'https://elemento.online/lib'

export const fileExists = (filePath: string): Promise<boolean> => fs.promises.access(filePath).then(() => true, () => false)

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
    downloadToFile(path: string, localFilePath: string, logError?: boolean): Promise<boolean>
    store(path: string, contents: Buffer, etag?: string): Promise<void>
    clear(): Promise<void>
    etag(path: string): Promise<string | undefined>
}

export async function getFromCache(cachePath: string, localPath: string, cache: ModuleCache) {
    const alreadyDownloaded = await fileExists(localPath)
    if (!alreadyDownloaded) {
        console.log('Fetching from cache', cachePath)
        await fs.promises.mkdir(path.dirname(localPath), {recursive: true})
        const foundInCache = await cache.downloadToFile(cachePath, localPath, true)
        if (!foundInCache) {
            throw new Error('File not found in cache: ' + cachePath)
        }
    }
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

    downloadToFile(path: string, localFilePath: string, logError = false): Promise<boolean> {
        return this.file(path).download({destination: localFilePath})
            .then( () => true, (e: any) => {
                if (logError) console.error('downloadToFile', e)
                return false
            })
    }

    exists(path: string) : Promise<boolean> {
        return this.file(path).exists().then( ([result]) => result)
    }

    async etag(path: string): Promise<string | undefined> {
        const exists = await this.exists(path)
        if (!exists) return undefined
        const [response] = await this.file(path).getMetadata()
        return response.metadata?.sourceEtag
    }

    async store(path: string, contents: Buffer, etag?: string): Promise<void> {
        const file = this.file(path)
        await file.save(contents)
        if (etag) {
            await file.setMetadata({metadata: {sourceEtag: etag}})
        }
    }

    async clear(prefix: string = ''): Promise<void> {
        const [cacheFiles] = await this.bucket().getFiles({prefix: this.cachePath(prefix)})
        await Promise.all(cacheFiles.map( f => this.bucket().file(f.name).delete()))
    }

    private bucket() {
        return getStorage().bucket(this.bucketName)
    }
    private file(path: string) {
        return this.bucket().file(this.cachePath(path))
    }

    private cachePath(path: string) {
        return 'deployCache' + '/' + path.replace(/^https?:\/\//, '')
    }
}

export const isCacheObjectSourceModified = async (url: string, cachePath: string, cache: ModuleCache) => {
    const etag = await cache.etag(cachePath)
    return axios.head(url, {
        headers: {'If-None-Match': etag},
        validateStatus: status => status <= 304
    }).then( resp => resp.status !== HttpStatusCode.NotModified)
}