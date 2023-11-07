import {Request} from 'express'
import {expressAdminApp} from './expressUtils.js'
import path from 'path'
import {deployToHosting} from './adminUtil.js'
import {clearCache, ModuleCache, putIntoCacheAndFile} from './util'

const checkData = (value: string | undefined, name: string) => {
    if (!value) {
        throw new Error(`${name} not supplied`)
    }
}

const createDeployHandler = ({localFilePath, moduleCache}: {localFilePath: string, moduleCache: ModuleCache}) =>
    async (req: Request, res: any, next: (err?: any) => void) => {
        console.log('deploy handler', req.url)
        console.log(process.env)
        try {
            const {username, repo, firebaseProject} = req.body
            const firebaseAccessToken = req.get('x-firebase-access-token')
            const gitHubAccessToken = req.get('x-github-access-token')

            checkData(username, 'GitHub username')
            checkData(repo, 'GitHub repo')
            checkData(firebaseProject, 'Firebase Project')
            checkData(gitHubAccessToken, 'GitHub access token')
            checkData(firebaseAccessToken, 'Google access token')

            const deployTag = new Date().toISOString().substring(0, 19)
            const checkoutPath = path.join(localFilePath, 'deploy', deployTag)
            const releaseResult = await deployToHosting({username, repo, firebaseProject, checkoutPath,
                firebaseAccessToken: firebaseAccessToken!, gitHubAccessToken: gitHubAccessToken!, moduleCache})
            res.send(releaseResult)
        } catch (err) {
            next(err)
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

export default function createAdminServer(props: {localFilePath: string, moduleCache: ModuleCache}) {
    console.log('createAdminServer', )
    const deployHandler = createDeployHandler(props)
    const putHandler = createPutHandler(props)
    const clearHandler = createClearHandler(props)
    return expressAdminApp(deployHandler, putHandler, clearHandler)
}
