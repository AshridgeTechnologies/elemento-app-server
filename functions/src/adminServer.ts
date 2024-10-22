import express, {Request} from 'express'
import path from 'path'
import {deployToHosting, setupProject} from './adminUtil.js'
import {AppServerProperties, checkData, clearCache, elementoHost} from './util.js'
import cors from 'cors'
import {errorHandler, logCall} from './expressUtils.js'
import {ModuleCache} from './CloudStorageCache.js'

const createDeployHandler = ({localFilePath, moduleCache}: AppServerProperties) =>
    async (req: Request, res: any, next: (err?: any) => void) => {
        console.log('deploy handler', req.url)
        console.log(process.env)
        try {
            const {gitRepoUrl} = req.body
            const firebaseAccessToken = req.get('x-firebase-access-token')
            const gitHubAccessToken = req.get('x-github-access-token')

            checkData(gitRepoUrl, 'Git URL', res)
            checkData(gitHubAccessToken, 'GitHub access token', res)
            checkData(firebaseAccessToken, 'Google access token', res)

            const firebaseProject: string | undefined = process.env.PROJECT_ID
            checkData(firebaseProject, 'Firebase Project in PROJECT_ID env variable', res)

            const deployTag = new Date().toISOString().substring(0, 19)
            const checkoutPath = path.join(localFilePath, 'deploy', deployTag)
            const releaseResult = await deployToHosting({gitRepoUrl, firebaseProject: firebaseProject!, checkoutPath,
                firebaseAccessToken: firebaseAccessToken!, gitHubAccessToken: gitHubAccessToken!, moduleCache})
            res.send(releaseResult)
        } catch (err) {
            next(err)
        }
    }

const createClearHandler = ({localFilePath, moduleCache}: { localFilePath: string, moduleCache: ModuleCache }) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('clear handler', req.url)
        try {
            const firebaseAccessToken: string = req.get('x-firebase-access-token')
            checkData(firebaseAccessToken, 'Google access token', res)
            await clearCache(localFilePath, moduleCache)
            res.end()
        } catch (err) {
            next(err)
        }
    }

const createSetupHandler = ({settingsStore}: { settingsStore: ModuleCache }) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('setup handler', req.url)
        try {
            const settings = req.body
            const firebaseAccessToken: string = req.get('x-firebase-access-token')
            checkData(firebaseAccessToken, 'Google access token', res)
            const firebaseProject: string | undefined = process.env.PROJECT_ID
            checkData(firebaseProject, 'Firebase Project in PROJECT_ID env variable', res)
            await setupProject({firebaseAccessToken, firebaseProject: firebaseProject!, settingsStore, settings})
            res.end()
        } catch (err) {
            next(err)
        }
    }

const createStatusHandler = ({settingsStore}: { settingsStore: ModuleCache }) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('status handler', req.url)
        try {
            const firebaseConfigFound = await settingsStore.exists('firebaseConfig.json')
            const statusResult = firebaseConfigFound ? {status: 'OK'} : {status: 'Error', description: 'Extension not set up'}
            res.send(statusResult)
        } catch (err) {
            next(err)
        }
    }

export default function createAdminServer(props: {localFilePath: string, moduleCache: ModuleCache, settingsStore: ModuleCache}) {
    console.log('createAdminServer', )
    const deployHandler = createDeployHandler(props)
    const clearHandler = createClearHandler(props)
    const setupHandler = createSetupHandler(props)
    const statusHandler = createStatusHandler(props)

    const app = express()
    app.use(logCall)
    app.use(cors({
        origin: [elementoHost, 'http://localhost:8000', 'http://localhost:8100'],
        methods: ['POST'],
        preflightContinue: false
    }))
    app.use(['/deploy','/setup'], express.json())
    app.post('/deploy', deployHandler)
    app.post('/clearcache', clearHandler)
    app.post('/setup', setupHandler)
    app.get('/status', statusHandler)
    app.use(errorHandler)
    return app
}
