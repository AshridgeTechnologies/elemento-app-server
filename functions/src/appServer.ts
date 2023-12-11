import {type AppFactory, errorHandler, logCall, requestHandler} from './expressUtils.js'
import fs from 'fs'
import path from 'path'
import {getFromCache} from './util.js'
import express from 'express'
import {ModuleCache} from './CloudStorageCache.js'

export type AppServerProperties = {
    localFilePath: string,
    moduleCache: ModuleCache,
}

function createAppFactory({localFilePath, moduleCache}: AppServerProperties): AppFactory {
    const elementoFilesPath = path.join(localFilePath, 'serverFiles')
    fs.mkdirSync(elementoFilesPath, {recursive: true})
    console.log('Storing files in', elementoFilesPath)

    return async (appName, user, version) => {
        const runtimeName = 'serverRuntime.cjs'
        const appFileName = `${appName}.mjs`
        const appModuleDir = path.join(elementoFilesPath, version, 'server')
        const appModulePath = path.join(appModuleDir, appFileName)
        const runtimePath = path.join(appModuleDir, runtimeName)
        const runtimeDownload = getFromCache(`${version}/server/${runtimeName}`, runtimePath, moduleCache)
        const moduleDownload = getFromCache(`${version}/server/${appFileName}`, appModulePath, moduleCache)

        await Promise.all([runtimeDownload, moduleDownload])
        const serverAppModule = await import('file://' + appModulePath)
        const serverApp = serverAppModule.default
        return serverApp(user)
    }
}

export default function createAppServer(props: AppServerProperties) {
    console.log('createAppServer')
    const appFactory = createAppFactory(props)

    const app = express()
    app.use(logCall)
    app.use(['/capi'], express.json())
    app.use(['/capi'], requestHandler(appFactory))
    app.use(errorHandler)
    return app
}
