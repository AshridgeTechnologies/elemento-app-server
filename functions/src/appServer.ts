import {type AppFactory, expressApp, LATEST} from './expressUtils.js'
import fs from 'fs'
import path from 'path'
import {clearCache, downloadModule, getFromCache, ModuleCache, putIntoCacheAndFile} from './util.js'

interface ConfigParam<T> {
    value(): T
}

type AppServerProperties = {
    runtimeImportPath: ConfigParam<string>,
    localFilePath: string,
    gitHubUserConfig: ConfigParam<string>,
    gitHubRepoConfig: ConfigParam<string>,
    moduleCache: ModuleCache,
    gitHubAccessTokenConfig?: ConfigParam<string>,
    gitHubServer?: string
}
type ClientHandlerProperties = {
    localFilePath: string,
    gitHubUserConfig: ConfigParam<string>,
    gitHubRepoConfig: ConfigParam<string>,
    moduleCache: ModuleCache,
    gitHubAccessTokenConfig?: ConfigParam<string>,
    gitHubServer?: string
}

export const GITHUB_RAW = 'https://raw.githubusercontent.com'

function createAppFactory({runtimeImportPath, localFilePath, gitHubUserConfig, gitHubRepoConfig,
                              gitHubAccessTokenConfig, moduleCache, gitHubServer = GITHUB_RAW}: AppServerProperties): AppFactory {
    const elementoFilesPath = path.join(localFilePath, 'serverFiles')
    fs.mkdirSync(elementoFilesPath, {recursive: true})
    console.log('Storing files in', elementoFilesPath)


    return async (appName, user, version = LATEST) => {
        const appFileName = `${appName}.mjs`
        const appModulePath = path.join(elementoFilesPath, version, appFileName)
        const serverRuntimeModulePath = path.join(elementoFilesPath, version, 'serverRuntime.cjs')
        const serverRuntimeDownload = downloadModule(`${runtimeImportPath.value()}/serverRuntime.cjs`, serverRuntimeModulePath, moduleCache)

        let moduleDownload
        if (version === 'preview') {
            const cachePath = `${version}/dist/server/${appFileName}`
            moduleDownload = getFromCache(cachePath, appModulePath, moduleCache)
        } else {
            const gitHubVersion = version === LATEST ? 'main' : version
            const gitHubUrl = `${gitHubServer}/${gitHubUserConfig.value()}/${gitHubRepoConfig.value()}/${gitHubVersion}/dist/server/${appFileName}`
            const accessToken = gitHubAccessTokenConfig?.value() || undefined
            moduleDownload = downloadModule(gitHubUrl, appModulePath, moduleCache, accessToken)
        }

        await Promise.all([serverRuntimeDownload, moduleDownload])
        const serverAppModule = await import('file://' + appModulePath)
        const serverApp = serverAppModule.default
        return serverApp(user)
    }
}

const createPutHandler = ({localFilePath, moduleCache}: {localFilePath: string, moduleCache: ModuleCache}) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('put handler', req.url)
        try {
            const elementoFilesPath = path.join(localFilePath, 'serverFiles')
            const appModulePath = path.join(elementoFilesPath, req.url)
            const cachePath = req.url
            const moduleContents = req.body as Buffer
            await putIntoCacheAndFile(cachePath, appModulePath, moduleCache, moduleContents)
            res.end()
        } catch (err) {
            next(err)
        }
    }

const createHtmlHandler = ({localFilePath, gitHubUserConfig, gitHubRepoConfig,
                               gitHubAccessTokenConfig, moduleCache, gitHubServer = GITHUB_RAW}: ClientHandlerProperties) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('html handler', req.url)
        const [, versionSegment, appName, fileName = 'index.html'] = req.url.match(/^\/(@[-\w]+\/)?([-\w]+)\/?([-.\w]+)?$/)
        const version = versionSegment ? versionSegment.slice(1, -1) : LATEST
        const filePath = `/${version}/${appName}/${fileName}`
        try {
            const clientDirPath = path.join(localFilePath, 'clientFiles')
            const clientFilePath = clientDirPath + filePath
            const gitHubVersion = version === LATEST ? 'main' : version
            const gitHubUrl = `${gitHubServer}/${gitHubUserConfig.value()}/${gitHubRepoConfig.value()}/${gitHubVersion}/dist/client/${appName}/${fileName}`
            const accessToken = gitHubAccessTokenConfig?.value() || undefined
            await downloadModule(gitHubUrl, clientFilePath, moduleCache, accessToken)
            const fileContents = await fs.promises.readFile(clientFilePath)
            res.setHeader('Content-Type', 'text/html')
            res.send(fileContents)
        } catch (err) {
            next(err)
        }
    }

const createJsHandler = ({localFilePath, gitHubUserConfig, gitHubRepoConfig,
                               gitHubAccessTokenConfig, moduleCache, gitHubServer = GITHUB_RAW}: ClientHandlerProperties) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('js handler', req.url)
        const [, versionSegment, appName, fileName] = req.url.match(/^\/(@[-\w]+\/)?([-\w]+)\/([-.\w]+)$/)
        const version = versionSegment ? versionSegment.slice(1, -1) : LATEST
        const filePath = `/${version}/${appName}/${fileName}`
        try {
            const clientDirPath = path.join(localFilePath, 'clientFiles')
            const clientFilePath = clientDirPath + filePath
            const gitHubVersion = version === LATEST ? 'main' : version
            const gitHubUrl = `${gitHubServer}/${gitHubUserConfig.value()}/${gitHubRepoConfig.value()}/${gitHubVersion}/dist/client/${appName}/${fileName}`
            const accessToken = gitHubAccessTokenConfig?.value() || undefined
            await downloadModule(gitHubUrl, clientFilePath, moduleCache, accessToken)
            const fileContents = await fs.promises.readFile(clientFilePath)
            res.setHeader('Content-Type', 'text/javascript')
            res.send(fileContents)
        } catch (err) {
            next(err)
        }
    }

const createClearHandler = ({localFilePath, moduleCache}: {localFilePath: string, moduleCache: ModuleCache}) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('clear handler', req.url)
        try {
            await clearCache(localFilePath, moduleCache)
            res.end()
        } catch (err) {
            next(err)
        }
    }



export default function createAppServer(props: AppServerProperties) {
    console.log('createAppServer', 'runtimeImportPath', props.runtimeImportPath.value())
    const {localFilePath, moduleCache, gitHubUserConfig, gitHubRepoConfig, gitHubAccessTokenConfig, gitHubServer} = props
    const appFactory = createAppFactory(props)
    const putHandler = createPutHandler({localFilePath, moduleCache})
    const htmlHandler = createHtmlHandler({localFilePath, moduleCache, gitHubUserConfig, gitHubRepoConfig, gitHubAccessTokenConfig, gitHubServer})
    const jsHandler = createJsHandler({localFilePath, moduleCache, gitHubUserConfig, gitHubRepoConfig, gitHubAccessTokenConfig, gitHubServer})
    const clearHandler = createClearHandler({localFilePath, moduleCache})
    return expressApp(appFactory, putHandler, htmlHandler, jsHandler, clearHandler)
}
