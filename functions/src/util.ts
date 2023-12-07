import fs from 'fs'
import {parseISO} from 'date-fns'
import path from 'path'
import axios, {HttpStatusCode, ResponseType} from 'axios'

export const elementoHost = 'https://elemento.online'
export const runtimeImportPath = elementoHost + '/lib'

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
    storeWithEtag(path: string, contents: Buffer, etag: string): Promise<void>
    clear(accessToken: string, prefix?: string): Promise<void>
    etag(path: string): Promise<string | undefined>

    storeWithPermissions(path: string, contents: Buffer, accessToken: string): Promise<void>
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

export async function putIntoCacheAndFile(cachePath: string, localPath: string, cache: ModuleCache, contents: Buffer, firebaseAccessToken: string) {
    await Promise.all([
        mkdirWriteFile(localPath, contents),
        cache.storeWithPermissions(cachePath, contents, firebaseAccessToken)
    ])
}

export function clearCache(localPath: string, cache: ModuleCache, accessToken: string, prefix?: string) {
    const dirToClear = path.join(localPath, prefix ?? '')
    return cache.clear(accessToken, prefix).then( ()=> rmdir(dirToClear))
}


export const isCacheObjectSourceModified = async (url: string, cachePath: string, cache: ModuleCache) => {
    const etag = await cache.etag(cachePath)
    return axios.head(url, {
        headers: {'If-None-Match': etag},
        validateStatus: status => status <= 304
    }).then( resp => resp.status !== HttpStatusCode.NotModified)
}

export async function googleApiRequest(host: string, path: string, accessToken: string, method?: string, data?: object) {
    const url = `${host}/${path}`
    const responseType = 'json' as ResponseType
    const headers = accessToken ? {headers: {Authorization: `Bearer ${accessToken}`}} : {}
    const options = {url, method, responseType, data, ...headers}
    const resp = await axios.request(options)
    if (resp.status !== 200 && resp.status !== 204) {
        const {message} = (resp as any).error
        throw new Error(`Error deploying to Firebase: ${message}`)
    }
    return await resp.data
}

export const checkData = (value: string | undefined, name: string) => {
    if (!value) {
        throw new Error(`${name} not supplied`)
    }
}