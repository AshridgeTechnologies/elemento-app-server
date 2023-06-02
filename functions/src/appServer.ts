import {type AppFactory, expressApp, LATEST} from './expressUtils.js'
import fs from 'fs'
import path from 'path'
import {downloadModule, ModuleCache} from './util.js'

interface ConfigParam<T> {
    value(): T
}

type AppServerProperties = {
    runtimeImportPath: string,
    moduleImportPath: string,
    gitHubUserConfig: ConfigParam<string>,
    gitHubRepoConfig: ConfigParam<string>,
    moduleCache: ModuleCache,
    gitHubAccessTokenConfig?: ConfigParam<string>,
    gitHubServer?: string
}

const GITHUB_RAW = 'https://raw.githubusercontent.com'

function createAppFactory({runtimeImportPath, moduleImportPath, gitHubUserConfig, gitHubRepoConfig,
                              gitHubAccessTokenConfig, moduleCache, gitHubServer = GITHUB_RAW}: AppServerProperties): AppFactory {
    const elementoFilesPath = path.join(moduleImportPath, 'appFiles')
    fs.mkdirSync(elementoFilesPath, {recursive: true})
    console.log('gitHubAccessTokenConfig', gitHubAccessTokenConfig, '|' + gitHubAccessTokenConfig?.value() + '|')
    console.log('Storing files in', elementoFilesPath)

    return async (appName, user, version = LATEST) => {
        const gitHubVersion = version === LATEST ? 'main' : version
        const appFileName = `${appName}.mjs`
        const appModulePath = path.join(elementoFilesPath, appFileName)
        const gitHubUrl = `${gitHubServer}/${gitHubUserConfig.value()}/${gitHubRepoConfig.value()}/${gitHubVersion}/dist/server/${appFileName}`
        const serverRuntimeModulePath = path.join(elementoFilesPath, 'serverRuntime.cjs')
        const accessToken = gitHubAccessTokenConfig?.value() || undefined
        console.log('accessToken', accessToken)
        await Promise.all([
            downloadModule(`${runtimeImportPath}/serverRuntime.cjs`, serverRuntimeModulePath, moduleCache),
            downloadModule(gitHubUrl, appModulePath, moduleCache, accessToken)
        ])
        const serverAppModule = await import('file://' + appModulePath)
        const serverApp = serverAppModule.default
        return serverApp(user)
    }
}

export default function createAppServer(props: AppServerProperties) {
    const appFactory = createAppFactory(props)
    return expressApp(appFactory)
}
