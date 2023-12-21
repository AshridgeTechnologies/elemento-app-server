import {test} from 'node:test'
import {expect} from 'expect'
import {type Server} from 'http'
import * as fs from 'fs'
import {googleApiRequest} from '../src/util'
import {getAccessToken, makeAdminServer, newTestDir, wait} from './testUtil'
import git from 'isomorphic-git'
// @ts-ignore
import admin from 'firebase-admin'
import * as dotenv from 'dotenv'
import {CloudStorageCache} from '../src/CloudStorageCache'

const getLatestCommitId = async (dir: string) => {
    const commits = await git.log({
        fs,
        dir,
        depth: 1,
    })
    return commits[0].oid.substring(0, 12)
}

const firebaseProject = 'elemento-hosting-test'
const bucketName = `${firebaseProject}.appspot.com`
const serviceAccountKeyPath = 'private/elemento-hosting-test-firebase-adminsdk-7en27-f3397ab7af.json'
const serviceAccountKey = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'))
admin.initializeApp({credential: admin.credential.cert(serviceAccountKey), storageBucket: bucketName})

async function clearWebApps(firebaseAccessToken: string) {
    const getApps = async () => {
        const response = await googleApiRequest(`https://firebase.googleapis.com/v1beta1`, `projects/${firebaseProject}/webApps`, firebaseAccessToken)
        return response.apps ?? []
    }
    for (const app of (await getApps())) {
        await googleApiRequest(`https://firebase.googleapis.com/v1beta1`, `projects/${firebaseProject}/webApps/${app.appId}:remove`, firebaseAccessToken,
            'POST', {immediate: true})
    }
    await expect(getApps()).resolves.toHaveLength(0)
    await wait(2000)
}

test('admin Server', async (t) => {

    let localFilePath: string
    let moduleCache = new CloudStorageCache('deployCache')
    let settingsStore = new CloudStorageCache('settings')
    let gitHubAccessToken: string, serviceAccountKey: string, firebaseAccessToken: string, headers: HeadersInit

    let server: Server | undefined, serverPort: number | undefined
    const stopServer = async () => server && await new Promise(resolve => server!.close(resolve as () => void))

    const requestData = {
        gitRepoUrl: 'https://github.com/rileydog16/Elemento-Test-2'
    }

    t.beforeEach(async () => {
        dotenv.populate(process.env, {PROJECT_ID: firebaseProject})
        expect(process.env.PROJECT_ID).toBe(firebaseProject)
        localFilePath = await newTestDir();
        await moduleCache.clear()
        await settingsStore.clear()
        gitHubAccessToken = await fs.promises.readFile('private/Elemento-Test-1-2RepoToken_finegrained.txt', 'utf8')
        serviceAccountKey = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'))
        firebaseAccessToken = await getAccessToken(serviceAccountKey);
        headers = ({
            'Content-Type': 'application/json',
            'x-firebase-access-token': firebaseAccessToken,
            'X-GitHub-Access-Token': gitHubAccessToken,
        });
        ({server, serverPort} = await makeAdminServer(localFilePath, moduleCache, settingsStore))
    })

    t.afterEach(stopServer)

    await t.test('setup initialises firebase project', { skip: false }, async () => {
        await clearWebApps(firebaseAccessToken)

        const setupUrl = `http://localhost:${serverPort}/setup`
        const previewPassword = 'pass' + Date.now()
        const settings = {
            previewPassword
        }
        const headers = ({
            'Content-Type': 'application/json',
            'x-firebase-access-token': firebaseAccessToken,
        })

        try {
            const setupResult = await fetch(setupUrl, {method: 'POST', headers, body: JSON.stringify(settings)})
            expect(setupResult.status).toBe(200)
            console.log('Settings updated')

            const tempFilePath = `${localFilePath}/temp1`
            await settingsStore.downloadToFile(`settings.json`, tempFilePath)
            const retrievedSettings = await fs.promises.readFile(tempFilePath, 'utf8').then(JSON.parse)
            expect(retrievedSettings.previewPassword).toBe(previewPassword)
            await settingsStore.downloadToFile(`firebaseConfig.json`, tempFilePath)
            const retrievedConfig = await fs.promises.readFile(tempFilePath, 'utf8').then(JSON.parse)
            expect(retrievedConfig.projectId).toBe(firebaseProject)
            expect(retrievedConfig.appId).toContain(':web:')

        } finally {
        }
    })

    await t.test('deploys client-only project from GitHub', { skip: false }, async () => {

        await clearWebApps(firebaseAccessToken)

        const deployUrl = `http://localhost:${serverPort}/deploy`
        try {
            const deployResult = await fetch(deployUrl, {method: 'POST', headers, body: JSON.stringify(requestData)}).then( resp => resp.json() )
            console.log('Deployed')
            const {releaseTime} = deployResult
            const releaseTimeMillis = new Date(releaseTime).getTime()
            expect(releaseTimeMillis - Date.now()).toBeLessThan(10000)

            const htmlPage = await fetch(`https://${firebaseProject}.web.app/MainApp`).then(resp => resp.text() )
            expect(htmlPage).toContain('<title>Main App</title>')

            const htmlPageWithPath = await fetch(`https://${firebaseProject}.web.app/MainApp/Page1/stuff`).then(resp => resp.text() )
            expect(htmlPageWithPath).toContain('<title>Main App</title>')

            const versionInfo = await fetch(`https://${firebaseProject}.web.app/version`).then(resp => resp.json() )
            const {deployTime} = versionInfo
            const deployTimeMillis = new Date(deployTime).getTime()
            expect(deployTimeMillis - Date.now()).toBeLessThan(5000)

            const firebaseConfig = await fetch(`https://${firebaseProject}.web.app/firebaseConfig.json`).then(resp => resp.json() )
            expect(firebaseConfig.projectId).toBe(firebaseProject)

            const deployDir = `${localFilePath}/deploy`
            const checkoutDir = (await fs.promises.readdir(deployDir))[0]
            const checkoutPath = `${deployDir}/${checkoutDir}`
            const commitId = await getLatestCommitId(checkoutPath)
            expect(versionInfo.commitId).toBe(commitId)
        } finally {
            await stopServer()
        }
    })

    await t.test('deploys project with server app from GitHub', { skip: false }, async () => {

        const deployUrl = `http://localhost:${serverPort}/deploy`
        try {
            const deployResult = await fetch(deployUrl, {method: 'POST', headers, body: JSON.stringify(requestData)}).then( resp => resp.json() )
            console.log('Deployed')
            const {releaseTime} = deployResult
            const releaseTimeMillis = new Date(releaseTime).getTime()
            expect(releaseTimeMillis - Date.now()).toBeLessThan(5000)

            const versionInfo = await fetch(`https://${firebaseProject}.web.app/version`).then(resp => resp.json() )
            const {deployTime} = versionInfo
            const deployTimeMillis = new Date(deployTime).getTime()
            expect(deployTimeMillis - Date.now()).toBeLessThan(5000)

            const deployDir = `${localFilePath}/deploy`
            const checkoutDir = (await fs.promises.readdir(deployDir))[0]
            const checkoutPath = `${deployDir}/${checkoutDir}`
            const commitId = await getLatestCommitId(checkoutPath)
            expect(versionInfo.commitId).toBe(commitId)

            const tempFilePath = `${localFilePath}/temp1`
            await moduleCache.downloadToFile(`${commitId}/server/ServerApp1.mjs`, tempFilePath)
            const fileContents = await fs.promises.readFile(tempFilePath, 'utf8')
            expect(fileContents).toContain('AddTen')
            await expect(moduleCache.exists(`${commitId}/server/serverRuntime.cjs`)).resolves.toBe(true)

            const apiResult = await fetch(`https://${firebaseProject}.web.app/capi/${commitId}/ServerApp1/AddTen?a=20`).then(resp => resp.json() )
            expect(apiResult).toBe(30)
        } finally {
            await stopServer()
        }
    })



})
