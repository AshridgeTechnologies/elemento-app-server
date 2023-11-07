import {type AppFactory, expressApp} from './expressUtils.js'
import fs from 'fs'
import path from 'path'
import {downloadModule, getFromCache, ModuleCache} from './util.js'

interface ConfigParam<T> {
    value(): T
}

type AppServerProperties = {
    runtimeImportPath: ConfigParam<string>,
    localFilePath: string,
    moduleCache: ModuleCache,
}
function createAppFactory({runtimeImportPath, localFilePath, moduleCache}: AppServerProperties): AppFactory {
    const elementoFilesPath = path.join(localFilePath, 'serverFiles')
    fs.mkdirSync(elementoFilesPath, {recursive: true})
    console.log('Storing files in', elementoFilesPath)

    return async (appName, user, version) => {
        const serverRuntimeModulePath = path.join(elementoFilesPath, version, 'server', 'serverRuntime.cjs')
        const serverRuntimeDownload = downloadModule(`${runtimeImportPath.value()}/serverRuntime.cjs`, serverRuntimeModulePath, moduleCache)

        const appFileName = `${appName}.mjs`
        const appModulePath = path.join(elementoFilesPath, version, 'server', appFileName)
        const cachePath = `${version}/server/${appFileName}`
        const moduleDownload = getFromCache(cachePath, appModulePath, moduleCache)

        await Promise.all([serverRuntimeDownload, moduleDownload])
        const serverAppModule = await import('file://' + appModulePath)
        const serverApp = serverAppModule.default
        return serverApp(user)
    }
}

export default function createAppServer(props: AppServerProperties) {
    console.log('createAppServer', 'runtimeImportPath', props.runtimeImportPath.value())
    const appFactory = createAppFactory(props)
    return expressApp(appFactory)
}
