import {test} from 'node:test'
import * as fs from 'fs'
import {getAccessToken, initializeApp, makeServer} from './testUtil'
import {deployAppServer} from '../src/installServer'
import {expect} from 'expect'
import {googleApiRequest} from '../src/util'
import type {Server} from 'http'

const {firebaseProject, projectNumber, serviceAccountKeyPath} = initializeApp()
const region = 'europe-west2'
const serviceName = 'elemento-app-server'

test('gcr install and update', async (t) => {
    const serviceAccountKey = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'))
    const firebaseAccessToken = await getAccessToken(serviceAccountKey)

    try {
        const deleteOperation = await googleApiRequest(`https://run.googleapis.com/v2`, `projects/${firebaseProject}/locations/${region}/services/${serviceName}`, firebaseAccessToken, 'DELETE')
        await googleApiRequest(`https://run.googleapis.com/v2`, `${deleteOperation.name}:wait`, firebaseAccessToken, 'POST', {timeout: '30s'})
        console.log('Deleted existing service before test')
    } catch (e) {
        console.log('No existing service found before test')
    }

    const statusUrl = `https://elemento-app-server-${projectNumber}.${region}.run.app/admin/status`

    await t.test('install app server to GCR', async () => {
        await deployAppServer({firebaseProject, region, firebaseAccessToken})
        const statusResult = await fetch(statusUrl).then( resp => resp.json() )
        expect(statusResult.status).toBeDefined()
    })

    // repeat should not fail
    await t.test('install app server to GCR', async () => {
        await deployAppServer({firebaseProject, region, firebaseAccessToken})
        const statusResult = await fetch(statusUrl).then( resp => resp.json() )
        expect(statusResult.status).toBeDefined()
    })
})

test('install Server', async (t) => {

    let serviceAccountKey: string, firebaseAccessToken: string, headers: HeadersInit

    let server: Server | undefined, serverPort: number | undefined
    const startServer = async () => {
        ({server, serverPort} = await makeServer({
            install: {},
        }))
    }
    const stopServer = async () => server && await new Promise(resolve => server!.close(resolve as () => void))

    t.beforeEach(async () => {
        serviceAccountKey = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'))
        firebaseAccessToken = await getAccessToken(serviceAccountKey);
        headers = ({
            'Content-Type': 'application/json',
            'x-firebase-access-token': firebaseAccessToken,
        });

    })

    await t.test('installs server in firebase project', { skip: false }, async () => {
        await startServer()

        const installUrl = `http://localhost:${serverPort}/install/install`
        try {
            const requestData = {firebaseProject, region}
            await fetch(installUrl, {method: 'POST', headers, body: JSON.stringify(requestData)})
            console.log('Installed')
            const statusUrl = `https://elemento-app-server-${projectNumber}.${region}.run.app/admin/status`
            const statusResult = await fetch(statusUrl).then( resp => resp.json() )
            expect(statusResult.status).toBeDefined()
        } finally {
            await stopServer()
        }
    })
})