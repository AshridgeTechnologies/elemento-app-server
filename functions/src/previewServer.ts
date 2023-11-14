import {expressPreviewApp} from './expressUtils.js'
import path from 'path'
import {fileExists, ModuleCache, putIntoCacheAndFile, runtimeImportPath} from './util.js'
import {createAppFactory} from './appServer'
import fs from 'fs'
import axios from 'axios'

async function downloadToCacheAndFile(url: string, localPath: string, cachePath: string, moduleCache: ModuleCache) {
    const fileBuffer: Buffer = await axios.get(url, {responseType: 'arraybuffer'}).then( resp => resp.data )
    await Promise.all([
        moduleCache.store(cachePath, fileBuffer),
        fs.promises.mkdir(path.dirname(localPath), {recursive: true}).then( ()=> fs.promises.writeFile(localPath, fileBuffer) )
    ])
}

const updateServerRuntime = async (serverRuntimeUrl: string, cachePath: string, localPath: string, cache: ModuleCache) => {
    const alreadyDownloaded = await fileExists(localPath)
    if (!alreadyDownloaded) {
        console.log('Fetching from cache', cachePath)
        await fs.promises.mkdir(path.dirname(localPath), {recursive: true})
        const foundInCache = await cache.downloadToFile(cachePath, localPath)
        if (!foundInCache) {
            await downloadToCacheAndFile(serverRuntimeUrl, localPath, cachePath, cache)
        }
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
    const appFactory = createAppFactory(props)
    const putHandler = createPutHandler(props)
    return expressPreviewApp(appFactory, putHandler)
}
