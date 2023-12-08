import express, {Request} from 'express'
import path from 'path'
import {deployToHosting} from './adminUtil.js'
import {checkData, clearCache, elementoHost, ModuleCache} from './util.js'
import cors from 'cors'
import {errorHandler, logCall} from './expressUtils.js'

const createDeployHandler = ({localFilePath, moduleCache}: {localFilePath: string, moduleCache: ModuleCache}) =>
    async (req: Request, res: any, next: (err?: any) => void) => {
        console.log('deploy handler', req.url)
        console.log(process.env)
        try {
            const {gitRepoUrl} = req.body
            const firebaseAccessToken = req.get('x-firebase-access-token')
            const gitHubAccessToken = req.get('x-github-access-token')

            checkData(gitRepoUrl, 'Git URL')
            checkData(gitHubAccessToken, 'GitHub access token')
            checkData(firebaseAccessToken, 'Google access token')

            const firebaseProject: string | undefined = process.env.PROJECT_ID
            checkData(firebaseProject, 'Firebase Project in PROJECT_ID env variable')

            const deployTag = new Date().toISOString().substring(0, 19)
            const checkoutPath = path.join(localFilePath, 'deploy', deployTag)
            const releaseResult = await deployToHosting({gitRepoUrl, firebaseProject: firebaseProject!, checkoutPath,
                firebaseAccessToken: firebaseAccessToken!, gitHubAccessToken: gitHubAccessToken!, moduleCache})
            res.send(releaseResult)
        } catch (err) {
            next(err)
        }
    }

    const createClearHandler = ({localFilePath, moduleCache}: {localFilePath: string, moduleCache: ModuleCache}) =>
    async (req: any, res: any, next: (err?: any) => void) => {
        console.log('clear handler', req.url)
        try {
            const firebaseAccessToken: string = req.get('x-firebase-access-token')
            checkData(firebaseAccessToken, 'Google access token')
            await clearCache(localFilePath, moduleCache, firebaseAccessToken)
            res.end()
        } catch (err) {
            next(err)
        }
    }

export default function createAdminServer(props: {localFilePath: string, moduleCache: ModuleCache}) {
    console.log('createAdminServer', )
    const deployHandler = createDeployHandler(props)
    const clearHandler = createClearHandler(props)

    const app = express()
    app.use(logCall)
    app.use(cors({
        origin: [elementoHost, 'http://localhost:8000'],
        methods: ['POST'],
        preflightContinue: false
    }))
    app.use(['/deploy',], express.json())
    app.post('/deploy', deployHandler)
    clearHandler && app.post('/clearcache', clearHandler)
    app.use(errorHandler)
    return app
}
