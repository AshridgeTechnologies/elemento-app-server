import express, {Request} from 'express'
import cors from 'cors'
import {checkData, elementoHost, googleApiRequest, InstallServerProperties} from './util.js'
import {wait} from './adminUtil.js'
import {errorHandler, logCall} from './expressUtils.js'

const runRootUrl = `https://run.googleapis.com/v2`
const runRequest = (path: string, accessToken: string, method: string = 'GET', data?: object) => googleApiRequest(runRootUrl, path, accessToken, method, data)
const serviceName = 'elemento-app-server'
const imageUrl = 'docker.io/ashridgetech/elemento-app-server:latest'

export async function deployAppServer({firebaseProject, region, firebaseAccessToken}:
                                          { firebaseProject: string, region: string, firebaseAccessToken: string }) {

    const getService = async () => {
        try {
            return await runRequest(`projects/${firebaseProject}/locations/${region}/services/${serviceName}`, firebaseAccessToken)
        } catch (e: any) {
            return null
        }
    }

    const existingService = await getService()
    console.log('existingService', existingService ? 'found' : 'not found')
    console.log(`Starting elemento-app-server service ${existingService ? 'update' : 'create'} in project ${firebaseProject}`)
    const serviceData = {
        template: {
            containers: [{
                image: imageUrl,
                env: [
                    {name: 'GOOGLE_CLOUD_PROJECT', value: firebaseProject}
                ]
            }]
        }}

    const method = existingService ? 'PATCH' : 'POST'
    const url = existingService ? `projects/${firebaseProject}/locations/${region}/services/${serviceName}` : `projects/${firebaseProject}/locations/${region}/services?serviceId=${serviceName}`
    const serviceOperation =  await runRequest(url, firebaseAccessToken, method, serviceData)

    const iamData = {
        policy: {
            version: 3,
            bindings: [
                {
                    role: 'roles/run.invoker',
                    members: ['allUsers']
                }
            ]
        }
    }
    await runRequest(`projects/${firebaseProject}/locations/${region}/services/${serviceName}:setIamPolicy`, firebaseAccessToken, 'POST', iamData)

    console.log('Waiting for create/update service')
    await runRequest(`${serviceOperation.name}:wait`, firebaseAccessToken, 'POST', {timeout: '30s'})
    const newService = await getService()
    const serviceUrl = newService.urls.find( (url: string) => url.includes('run.app'))

    // wait for service to be ready
    const statusUrl = `${serviceUrl}/admin/status`
    console.log('Waiting for service to respond at', statusUrl)
    let responseOk = false
    for (let tries = 0; !responseOk && tries < 30; tries++) {
        await wait(1000)
        const response = await fetch(statusUrl)
        responseOk = response.ok
    }

    console.log('Service deploy finished - status', responseOk ? 'ok' : 'failed')
}

const createInstallHandler = (_props: InstallServerProperties) =>
    async (req: Request, res: any, next: (err?: any) => void) => {
        console.log('install handler', req.url)
        try {
            const {firebaseProject, region} = req.body
            const firebaseAccessToken = req.get('x-firebase-access-token')

            checkData(firebaseAccessToken, 'Google access token', res)
            checkData(region, 'Region', res)
            checkData(firebaseProject, 'Firebase Project', res)

            const releaseResult = await deployAppServer({firebaseProject, region, firebaseAccessToken: firebaseAccessToken!})
            res.send(releaseResult)
        } catch (err) {
            next(err)
        }
    }

export default function createInstallServer(props: InstallServerProperties) {
    console.log('createInstallServer', )
    const installHandler = createInstallHandler(props)

    const app = express()
    app.use(logCall)
    app.use(cors({
        origin: [elementoHost, 'http://localhost:8000', 'http://localhost:8100'],
        methods: ['POST'],
        preflightContinue: false
    }))
    app.use(['/install'], express.json())
    app.post('/install', installHandler)
    app.use(errorHandler)
    return app
}
