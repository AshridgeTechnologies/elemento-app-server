import {test} from 'node:test'
import * as fs from 'fs'
import {getAccessToken, initializeApp, wait} from './testUtil'
import {deployAppServer} from '../src/gcrInstall'
import {expect} from 'expect'
import {googleApiRequest} from '../src/util'

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
        expect(statusResult).toStrictEqual({status: "Error", description: "Extension not set up"})
    })

    // repeat should not fail
    await t.test('install app server to GCR', async () => {
        await deployAppServer({firebaseProject, region, firebaseAccessToken})
        const statusResult = await fetch(statusUrl).then( resp => resp.json() )
        expect(statusResult).toStrictEqual({status: "Error", description: "Extension not set up"})
    })
})