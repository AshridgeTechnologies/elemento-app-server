import {AppFactory, expressPreviewApp} from './expressUtils.js'
import path from 'path'
import {fileExists, getFromCache, isCacheObjectSourceModified, ModuleCache, putIntoCacheAndFile, runtimeImportPath} from './util.js'
import {AppServerProperties} from './appServer'
import fs from 'fs'
import axios from 'axios'

const lastUpdateTimes: {[appName: string]: number} = {}

async function downloadToCacheAndFile(url: string, localPath: string, cachePath: string, moduleCache: ModuleCache) {
    const response = await axios.get(url, {responseType: 'arraybuffer'})
    const etag = response.headers['etag']
    const fileBuffer: Buffer = await response.data
    await Promise.all([
        moduleCache.store(cachePath, fileBuffer, etag),
        fs.promises.mkdir(path.dirname(localPath), {recursive: true}).then( ()=> fs.promises.writeFile(localPath, fileBuffer) )
    ])
}

let lastModifiedCheckTime = 0
const updateServerRuntime = async (serverRuntimeUrl: string, cachePath: string, localPath: string, cache: ModuleCache) => {
    if (Date.now() - lastModifiedCheckTime > 60000) {
        const modified = await isCacheObjectSourceModified(serverRuntimeUrl, cachePath, cache)
        lastModifiedCheckTime = Date.now()
        if (modified) {
            await downloadToCacheAndFile(serverRuntimeUrl, localPath, cachePath, cache)
        }
    }

    const alreadyDownloaded = await fileExists(localPath)
    if (!alreadyDownloaded) {
        console.log('Fetching from cache', cachePath)
        await fs.promises.mkdir(path.dirname(localPath), {recursive: true})
        const foundInCache = await cache.downloadToFile(cachePath, localPath, true)
        if (!foundInCache) {
            throw new Error(`File ${cachePath} not found in cache`)
        }
    }
}

function createPreviewAppFactory({localFilePath, moduleCache}: AppServerProperties): AppFactory {
    const elementoFilesPath = path.join(localFilePath, 'serverFiles')
    fs.mkdirSync(elementoFilesPath, {recursive: true})
    console.log('Storing files in', elementoFilesPath)

    async function loadAppModule(appModuleCode: string, runtimePath: string) {
        const functionBody = appModuleCode
            .replace(/^import serverRuntime .*/, `return import('${runtimePath}').then( serverRuntime => {`)
            .replace(/export default *(\w+)/, 'return {default: $1}') + '\n})'
        console.log('functionBody', functionBody)
        const appModuleGeneratorFn = new Function(functionBody)
        return await appModuleGeneratorFn()
    }

    async function getApp(appName: string, version: string) {
        const runtimeName = 'serverRuntime.cjs'
        const appFileName = `${appName}.mjs`
        const appModuleDir = path.join(elementoFilesPath, version, 'server')
        const appModulePath = path.join(appModuleDir, appFileName)
        const runtimePath = path.join(appModuleDir, runtimeName)
        const runtimeDownload = getFromCache(`${version}/server/${runtimeName}`, runtimePath, moduleCache)
        const moduleDownload = getFromCache(`${version}/server/${appFileName}`, appModulePath, moduleCache)

        await Promise.all([runtimeDownload, moduleDownload])

        const appModuleCode = await fs.promises.readFile(appModulePath, 'utf8')
        const serverAppModule = await loadAppModule(appModuleCode, runtimePath)
        return serverAppModule.default
    }

    return async (appName, user, version) => {
        const serverApp = await getApp(appName, version)
        return serverApp(user)
    }
}

const createPutHandler = ({localFilePath, moduleCache}: {localFilePath: string, moduleCache: ModuleCache}) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('put handler', req.url)
        try {
            const elementoFilesPath = path.join(localFilePath, 'serverFiles')
            const appModulePath = path.join(elementoFilesPath, req.url)
            const serverRuntimeUrl = `${runtimeImportPath}/serverRuntime.cjs`
            const serverRuntimePath = 'preview/server/serverRuntime.cjs'
            const serverRuntimeLocalPath = path.join(elementoFilesPath, serverRuntimePath)
            const cachePath = req.url.substring(1)
            const moduleContents = req.body as Buffer
            await putIntoCacheAndFile(cachePath, appModulePath, moduleCache, moduleContents)
            await updateServerRuntime(serverRuntimeUrl, serverRuntimePath, serverRuntimeLocalPath, moduleCache)
            res.end()
        } catch (err) {
            next(err)
        }
    }

export default function createPreviewServer(props: {localFilePath: string, moduleCache: ModuleCache}) {
    console.log('createPreviewServer', )
    const appFactory = createPreviewAppFactory(props)
    const putHandler = createPutHandler(props)
    return expressPreviewApp(appFactory, putHandler)
}
