import fs from 'fs'
import path from 'path'
import axios, {HttpStatusCode, ResponseType} from 'axios'
import {ModuleCache} from './CloudStorageCache.js'

export const elementoHost = 'https://elemento.online'
export const runtimeImportPath = elementoHost + '/lib'

export type AppServerProperties = {
    localFilePath: string,
    moduleCache: ModuleCache,
}

export type AdminServerProperties = AppServerProperties & {settingsStore: ModuleCache, defaultFirebaseProject: string}
export type InstallServerProperties = {}
export type PreviewServerProperties = AppServerProperties & {settingsStore: ModuleCache}
export type AllServerProperties = {
    app?: AppServerProperties,
    admin?: AdminServerProperties,
    preview?: PreviewServerProperties,
    install?: InstallServerProperties
}

export const fileExists = (filePath: string): Promise<boolean> => fs.promises.access(filePath).then(() => true, () => false)

const mkdirWriteFile = (localPath: string, contents: Buffer) =>
        fs.promises.mkdir(path.dirname(localPath), {recursive: true})
        .then( () => fs.promises.writeFile(localPath, contents) )

const rmdir = (localPath: string) => fs.promises.rm(localPath, {recursive: true, force: true})

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

export async function readFromCache(cachePath: string, localPath: string, cache: ModuleCache) {
    await getFromCache(cachePath, localPath, cache)
    return fs.promises.readFile(localPath, 'utf8')
}

export async function putIntoCacheAndFile(cachePath: string, localPath: string, cache: ModuleCache, contents: Buffer) {
    await Promise.all([
        mkdirWriteFile(localPath, contents),
        cache.store(cachePath, contents)
    ])
}

export function clearCache(localPath: string, cache: ModuleCache) {
    return cache.clear().then( ()=> rmdir(localPath))
}

export async function googleApiRequest(host: string, path: string, accessToken: string, method?: string, data?: object) {
    const url = `${host}/${path}`
    const responseType = 'json' as ResponseType
    const headers = accessToken ? {headers: {Authorization: `Bearer ${accessToken}`}} : {}
    const options = {url, method, responseType, data, ...headers}
    const resp = await axios.request(options)
    if (resp.status !== 200 && resp.status !== 204) {
        const {message} = (resp as any).error
        throw new Error(`Error in request to Google: ${message}`)
    }
    return await resp.data
}

export const checkData = (value: string | undefined, name: string, res: any) => {
    if (!value) {
        res.status(400).send(`${name} not supplied`)
        return false
    }
    return true
}

export function bufferFromJson(json: object) {
    return Buffer.from(JSON.stringify(json, null, 2), 'utf8')
}
