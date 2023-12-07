import {AppFactory, expressPreviewApp} from './expressUtils.js'
import path from 'path'
import {checkData, clearCache, getFromCache, isCacheObjectSourceModified, ModuleCache, putIntoCacheAndFile, runtimeImportPath} from './util.js'
import {AppServerProperties} from './appServer'
import fs from 'fs'
import axios from 'axios'

const FILE_HEADER_PREFIX = '//// File: '
const EOF_DELIMITER = '//// End of file'
const appModuleCache: {[appName: string]: Function | null} = {}

async function downloadToCacheAndFileWithEtag(url: string, localPath: string, cachePath: string, moduleCache: ModuleCache) {
    const response = await axios.get(url, {responseType: 'arraybuffer'})
    const etag = response.headers['etag']
    const fileBuffer: Buffer = await response.data
    await Promise.all([
        moduleCache.storeWithEtag(cachePath, fileBuffer, etag),
        fs.promises.mkdir(path.dirname(localPath), {recursive: true}).then( ()=> fs.promises.writeFile(localPath, fileBuffer) )
    ])
}

type FileItems = {[name: string]: string}
function extractFileItems(combinedFiles: string): FileItems {
    const fileItems = combinedFiles.split(EOF_DELIMITER).filter( item => item.trim() !== '')
    return Object.fromEntries(fileItems.map( item => {
        const fileNameRegex = new RegExp(`${FILE_HEADER_PREFIX}(\\S+)`)
        const match = item.match(fileNameRegex) || []
        const filePath = match[1]
        const fileText = item.replace(fileNameRegex, '').trim()
        return [filePath, fileText]
    }))
}

let lastModifiedCheckTime = 0
const updateServerRuntime = async (serverRuntimeUrl: string, cachePath: string, localPath: string, cache: ModuleCache) => {
    if (Date.now() - lastModifiedCheckTime > 60000) {
        const modified = await isCacheObjectSourceModified(serverRuntimeUrl, cachePath, cache)
        lastModifiedCheckTime = Date.now()
        if (modified) {
            await downloadToCacheAndFileWithEtag(serverRuntimeUrl, localPath, cachePath, cache)
        }
    }
}

function createPreviewAppFactory({localFilePath, moduleCache}: AppServerProperties): AppFactory {
    const elementoFilesPath = path.join(localFilePath, 'serverFiles')
    fs.mkdirSync(elementoFilesPath, {recursive: true})
    console.log('Storing files in', elementoFilesPath)

    async function loadAppModule(appModuleCode: string, runtimePath: string) {
        const functionBody = appModuleCode
            .replace(/^import +(\* +as +)?serverRuntime .*/, '// $&')
            .replace(/export default *(\w+)/, 'return {default: $1}')
        const appModuleGeneratorFn = new Function('serverRuntime', functionBody)
        const serverRuntime = await import(runtimePath)
        return await appModuleGeneratorFn(serverRuntime)
    }

    async function getApp(appName: string, version: string): Promise<Function> {
        if (!appModuleCache[appName]) {
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
            appModuleCache[appName] = serverAppModule.default
        }

        return appModuleCache[appName]!
    }

    return async (appName, user, version) => {
        const serverApp = await getApp(appName, version)
        return serverApp(user)
    }
}

const createPutHandler = ({localFilePath, moduleCache}: {localFilePath: string, moduleCache: ModuleCache}) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('put handler', req.url)

        const firebaseAccessToken: string = req.get('x-firebase-access-token')
        checkData(firebaseAccessToken, 'Google access token')
        const elementoFilesPath = path.join(localFilePath, 'serverFiles')

        async function storeFile(filePath: string, fileText: string) {
            const fileContents = Buffer.from(fileText)
            const appModulePath = path.join(elementoFilesPath, filePath)
            await putIntoCacheAndFile(filePath, appModulePath, moduleCache, fileContents, firebaseAccessToken)
            const [, appName] = filePath.match(/\/(\w+)\.[mc]?js$/) || []
            if (appName) {
                appModuleCache[appName] = null
            }
        }

        try {
            const bodyContents = (req.body as Buffer).toString()
            const fileItems = extractFileItems(bodyContents)
            const filePromises = Object.entries(fileItems).map(([filePath, fileText]) => storeFile(`preview/${filePath}`, fileText))
            await Promise.all(filePromises)

            const serverRuntimeUrl = `${runtimeImportPath}/serverRuntime.cjs`
            const serverRuntimePath = 'preview/server/serverRuntime.cjs'
            const serverRuntimeLocalPath = path.join(elementoFilesPath, serverRuntimePath)
            await updateServerRuntime(serverRuntimeUrl, serverRuntimePath, serverRuntimeLocalPath, moduleCache)
            res.end()
        } catch (err) {
            next(err)
        }
    }

const createClearHandler = ({localFilePath, moduleCache}: {localFilePath: string, moduleCache: ModuleCache}) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('clear handler', req.url)
        const elementoFilesPath = path.join(localFilePath, 'serverFiles')
        try {
            const firebaseAccessToken: string = req.get('x-firebase-access-token')
            checkData(firebaseAccessToken, 'Google access token')
            await clearCache(elementoFilesPath, moduleCache, firebaseAccessToken, 'preview')
            res.end()
        } catch (err) {
            next(err)
        }
    }


export default function createPreviewServer(props: {localFilePath: string, moduleCache: ModuleCache}) {
    console.log('createPreviewServer', )
    const appFactory = createPreviewAppFactory(props)
    const putHandler = createPutHandler(props)
    const clearHandler = createClearHandler(props)
    return expressPreviewApp(appFactory, putHandler, clearHandler)
}
