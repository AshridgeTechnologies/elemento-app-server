import {test} from 'node:test'
import {expect} from 'expect'
import {createServer} from '../src/server'
import * as os from 'os'
import {type Server} from 'http'
import * as fs from 'fs'
import axios from 'axios'
import {getAccessToken, makeAdminServer, newTestDir, serverAppCode, wait} from './testUtil'
import {CloudStorageCache, ModuleCache} from '../src/CloudStorageCache'
import {AllServerProperties, bufferFromJson, fileExists, googleApiRequest, putIntoCacheAndFile} from '../src/util'
import * as dotenv from 'dotenv'
import git from 'isomorphic-git'
// @ts-ignore
import admin from 'firebase-admin'
import {getStorage} from 'firebase-admin/storage'

const firebaseProject = 'elemento-hosting-test'
const bucketName = `${firebaseProject}.appspot.com`
const serviceAccountKeyPath = 'private/elemento-hosting-test-firebase-adminsdk-7en27-f3397ab7af.json'
const serviceAccountKey = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'))
admin.initializeApp({credential: admin.credential.cert(serviceAccountKey), storageBucket: bucketName})

const runtimeImportPath = 'http://127.0.0.1:8000/lib'

let seq = 1
const previewPassword = 'pass' + Date.now()

const createModuleCache = (): ModuleCache & {modules:any} => ({
    modules: {},
    downloadToFile(cachePath: string, localPath: string, _ = false): Promise<boolean> {
        if (this.modules[cachePath]) {
            return fs.promises.writeFile(localPath, this.modules[cachePath]).then( () => true )
        }
        return Promise.resolve(false)
    },
    exists(cachePath: string): Promise<boolean> {
        return Promise.resolve(!!this.modules[cachePath])
    },
    clear() {
        this.modules = {}
        return Promise.resolve()
    },
    etag(_: string) { return undefined },
    store(path: string, contents: Buffer, _?: string) {
        this.modules[path] = contents
        return Promise.resolve()
    }
})

let dirSeq = 0
async function newModuleImportDir() {
    const localFilePath = `${os.tmpdir()}/appServer.test.${++dirSeq}`
    await fs.promises.rm(localFilePath, {force: true, recursive: true})
    return localFilePath
}

const fetchJson = (url: string) => fetch(url, {headers: { Accept: 'application/json'}}).then(resp => {
    expect(resp.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    return resp.json()
})

const getLatestCommitId = async (dir: string) => {
    const commits = await git.log({
        fs,
        dir,
        depth: 1,
    })
    return commits[0].oid.substring(0, 12)
}

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

const validPreviewHeaders = {
    'Content-Type': 'text/plain',
    'x-preview-password': previewPassword,
}
async function cachedFileContents(path: string, localFilePath: string, moduleCache: ModuleCache) {
    const tempFilePath = `${localFilePath}/temp${seq++}`
    await moduleCache.downloadToFile(path, tempFilePath)
    return await fs.promises.readFile(tempFilePath, 'utf8')
}


async function makeServer(props: AllServerProperties) {
    const serverPort = 7655
    const theAppServer = createServer(props)
    const server = theAppServer.listen(serverPort)
    return {serverPort, server}
}

test.skip('app Server', async (t) => {

    let localFilePath: string, previewLocalFilePath: string
    let appModuleCache: ModuleCache & {modules: any}
    let adminModuleCache: ModuleCache & {modules: any}
    let previewModuleCache: ModuleCache & {modules: any}
    let settingsStore: ModuleCache & {modules: any}
    let testVersion = 'abcd1234'
    let server: Server | undefined, serverPort: number | undefined
    const serverRuntimeBuffer: Buffer = await axios.get(`${runtimeImportPath}/serverRuntime.cjs`, {responseType: 'arraybuffer'}).then( resp => resp.data )

    const stopServer = async () => server && await new Promise(resolve => server!.close(resolve as () => void))

    t.beforeEach( async () => {
        localFilePath = await newModuleImportDir()
        previewLocalFilePath = await newModuleImportDir()
        appModuleCache = createModuleCache()
        adminModuleCache = createModuleCache()
        previewModuleCache = createModuleCache()
        settingsStore = createModuleCache()
        await appModuleCache.store(`${testVersion}/server/ServerApp1.mjs`, Buffer.from(serverAppCode), 'abc123');
        await appModuleCache.store(`${testVersion}/server/serverRuntime.cjs`, serverRuntimeBuffer, 'abc123');
        ({server, serverPort} = await makeServer({
            app: {localFilePath, moduleCache: appModuleCache},
            admin: {localFilePath, moduleCache: adminModuleCache, settingsStore },
            preview: {localFilePath, moduleCache: previewModuleCache, settingsStore }
        }))
    })

    await t.test('app server runs server app on given version from cached module', async () => {

        try {
            expect(await fetchJson(`http://localhost:${serverPort}/app/capi/${testVersion}/ServerApp1/Plus?a=37&b=5`)).toBe(42)
            expect(await fetchJson(`http://localhost:${serverPort}/app/capi/${testVersion}/ServerApp1/Plus?a=99&b=1`)).toBe(100)
        } finally {
            await stopServer()
        }
    })

    await t.test('app server runs server app and returns error messages', async () => {
        try {
            expect(await fetchJson(`http://localhost:${serverPort}/app/capi/${testVersion}/ServerApp1`)).toStrictEqual({error: {status: 404, message: 'Not Found'}})
            expect(await fetchJson(`http://localhost:${serverPort}/app/capi/${testVersion}/ServerApp1/BadFunction`)).toStrictEqual({error: {status: 404, message: 'Not Found: BadFunction'}})
            expect(await fetchJson(`http://localhost:${serverPort}/app/capi/${testVersion}/ServerApp1/BlowUp?c=1&d=2`)).toStrictEqual({error: {status: 500, message: 'Boom!'}})
        } finally {
            await stopServer()
        }
    })
})

test.skip('admin Server', async (t) => {

    let localFilePath: string, previewLocalFilePath: string
    let appModuleCache: ModuleCache & {modules: any}
    let adminModuleCache: ModuleCache & {modules: any}
    let previewModuleCache: ModuleCache & {modules: any}
    let settingsStore: ModuleCache & {modules: any}
    let gitHubAccessToken: string, serviceAccountKey: string, firebaseAccessToken: string, headers: HeadersInit

    let server: Server | undefined, serverPort: number | undefined
    const stopServer = async () => server && await new Promise(resolve => server!.close(resolve as () => void))

    const requestData = {
        gitRepoUrl: 'https://github.com/rileydog16/Elemento-Test-2'
    }

    t.beforeEach(async () => {
        dotenv.populate(process.env, {PROJECT_ID: firebaseProject})
        expect(process.env.PROJECT_ID).toBe(firebaseProject)
        gitHubAccessToken = await fs.promises.readFile('private/Elemento-Test-1-2RepoToken_finegrained.txt', 'utf8')
        serviceAccountKey = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'))
        firebaseAccessToken = await getAccessToken(serviceAccountKey);
        headers = ({
            'Content-Type': 'application/json',
            'x-firebase-access-token': firebaseAccessToken,
            'X-GitHub-Access-Token': gitHubAccessToken,
        });

        localFilePath = await newTestDir()
        previewLocalFilePath = await newModuleImportDir()
        appModuleCache = createModuleCache()
        adminModuleCache = createModuleCache()
        previewModuleCache = createModuleCache()
        settingsStore = createModuleCache();

        ({server, serverPort} = await makeServer({
            app: {localFilePath, moduleCache: appModuleCache},
            admin: {localFilePath, moduleCache: adminModuleCache, settingsStore },
            preview: {localFilePath, moduleCache: previewModuleCache, settingsStore }
        }))
    })

    t.afterEach(stopServer)

    await t.test('setup initialises firebase project', { skip: false }, async () => {
        await clearWebApps(firebaseAccessToken)

        const statusUrl = `http://localhost:${serverPort}/admin/status`
        const setupUrl = `http://localhost:${serverPort}/admin/setup`
        const previewPassword = 'pass' + Date.now()
        const settings = {
            previewPassword
        }
        const headers = ({
            'Content-Type': 'application/json',
            'x-firebase-access-token': firebaseAccessToken,
        })

        try {
            const statusResult = await fetch(statusUrl).then( resp => resp.json() )
            expect(statusResult).toStrictEqual({status: 'Error', description: 'Extension not set up'})

            const setupResult = await fetch(setupUrl, {method: 'POST', headers, body: JSON.stringify(settings)})
            expect(setupResult.status).toBe(200)
            console.log('Settings updated')

            const updatedStatusResult = await fetch(statusUrl).then( resp => resp.json() )
            expect(updatedStatusResult).toStrictEqual({status: 'OK'})

            const tempFilePath = `${localFilePath}/temp1`
            await settingsStore.downloadToFile(`.settings.json`, tempFilePath)
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

        const deployUrl = `http://localhost:${serverPort}/admin/deploy`
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

        const deployUrl = `http://localhost:${serverPort}/admin/deploy`
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
            await adminModuleCache.downloadToFile(`${commitId}/server/ServerApp1.mjs`, tempFilePath)
            const fileContents = await fs.promises.readFile(tempFilePath, 'utf8')
            expect(fileContents).toContain('AddTen')
            await expect(adminModuleCache.exists(`${commitId}/server/serverRuntime.cjs`)).resolves.toBe(true)

            const apiResult = await fetch(`https://${firebaseProject}.web.app/capi/${commitId}/ServerApp1/AddTen?a=20`).then(resp => resp.json() )
            expect(apiResult).toBe(30)
        } finally {
            await stopServer()
        }
    })

})

test('preview Server', async (t) => {
    let localFilePath: string, previewLocalFilePath: string
    let appModuleCache: ModuleCache & {modules: any}
    let adminModuleCache: ModuleCache & {modules: any}
    let previewModuleCache: ModuleCache & {modules: any}
    let settingsStore: ModuleCache & {modules: any}
    let server: Server | undefined, serverPort: number | undefined
    const stopServer = async () => server && await new Promise(resolve => server!.close(resolve as () => void))

    t.beforeEach(async () => {
        localFilePath = await newTestDir('previewServer');
        previewLocalFilePath = await newModuleImportDir()
        appModuleCache = createModuleCache()
        adminModuleCache = createModuleCache()
        previewModuleCache = createModuleCache()
        settingsStore = createModuleCache();
        await settingsStore.store('.settings.json', bufferFromJson({previewPassword}));
        ({server, serverPort} = await makeServer({
            app: {localFilePath, moduleCache: appModuleCache},
            admin: {localFilePath, moduleCache: adminModuleCache, settingsStore },
            preview: {localFilePath, moduleCache: previewModuleCache, settingsStore }
        }))
    })

    t.afterEach(stopServer)

    await t.test('serves firebase config from settings', async () => {
        const projectId = firebaseProject
        await settingsStore.store('firebaseConfig.json', bufferFromJson({projectId}))
        const getConfigUrl = `http://localhost:${serverPort}/preview/firebaseConfig.json`
        const config = await fetch(getConfigUrl).then(resp => resp.json() )
        expect(config).toStrictEqual({projectId})
    })

    await t.test('does not serve .settings.json file ', async () => {
        const getSettingsUrl = `http://localhost:${serverPort}/preview/.settings.json`
        const resp = await fetch(getSettingsUrl)
        expect(resp.status).toBe(404)
    })

    await t.test('deploys server app preview and updates it and serves result', async () => {
        const putPreviewUrl = `http://localhost:${serverPort}/preview`
        const getPreviewUrl = `http://localhost:${serverPort}/preview/capi/preview`
        const deployTime = Date.now()
        const serverAppWithTotalFunction = serverAppCode.replace('//Totalcomment', '').replace( '// time', '// time ' + deployTime)
        const serverAppPath = 'server/ServerApp1.mjs'
        const body1 = `//// File: ${serverAppPath}\n${serverAppWithTotalFunction}\n//// End of file\n`
            + `//// File: file2.txt\nSome text\n//// End of file\n`

        const cachedFile = (path: string) => cachedFileContents(path, localFilePath, previewModuleCache)

        try {
            const resp = await fetch(putPreviewUrl, {method: 'PUT', headers: validPreviewHeaders, body: body1})
            expect(resp.status).toBe(200)
            console.log('Preview deployed')

            expect(await cachedFile(`preview/server/ServerApp1.mjs`)).toBe(serverAppWithTotalFunction)
            expect(await cachedFile(`preview/file2.txt`)).toBe('Some text')

            const apiResult = await fetch(`${getPreviewUrl}/ServerApp1/Total?x=20&y=30&z=40`).then(resp => resp.json() )
            expect(apiResult).toBe(90)

            const serverAppWithDifference = serverAppCode.replace('//Differencecomment', '').replace( '// time', '// time ' + deployTime)
            const body2 = `//// File: ${serverAppPath}\n${serverAppWithDifference}\n//// End of file`
            await fetch(putPreviewUrl, {method: 'PUT', headers: validPreviewHeaders, body: body2})
            const differenceResult = await fetch(`${getPreviewUrl}/ServerApp1/Difference?x=20&y=30`).then(resp => resp.json() )
            expect(differenceResult).toBe(-10)
        } finally {
            await stopServer()
        }
    })

    await t.test('does not deploy server app preview if invalid password supplied', async () => {

        const previewHeaders = {
            'Content-Type': 'text/plain',
            'x-preview-password': previewPassword + 'x',
        }
        const putPreviewUrl = `http://localhost:${serverPort}/preview`
        try {
            const body = `//// File: server/ServerApp1.mjs\n${serverAppCode}\n//// End of file`
            const response = await fetch(putPreviewUrl, {method: 'PUT', headers: previewHeaders, body})
            expect(response.ok).toBe(false)
        }  finally {
            await stopServer()
        }
    })

    await t.test('clears all of preview cache', async () => {
        const clearPreviewUrl = `http://localhost:${serverPort}/preview/clear`

        await putIntoCacheAndFile('preview/file1.txt', localFilePath + '/serverFiles/preview/file1.txt', previewModuleCache, Buffer.from('file 1 contents'))
        await putIntoCacheAndFile('deploy1/file2.txt', localFilePath + '/serverFiles/deploy1/file2.txt', previewModuleCache, Buffer.from('file 2 contents'))
        const otherFile = getStorage().bucket().file('previewCache' + '_not' + '/'+ 'otherFile.txt')
        await otherFile.save('other file')
        try {
            const response = await fetch(clearPreviewUrl, {method: 'POST', headers: validPreviewHeaders})
            expect(response.ok).toBe(true)
            await expect(previewModuleCache.exists(`deploy1/file2.txt`)).resolves.toBe(false)
            await expect(previewModuleCache.exists(`preview/file1.txt`)).resolves.toBe(false)
            await expect(fileExists(localFilePath + '/' + 'serverFiles/deploy1/file2.txt')).resolves.toBe(false)
            await expect(fileExists(localFilePath + '/' + 'serverFiles/preview/file1.txt')).resolves.toBe(false)
            await expect(otherFile.exists()).resolves.toStrictEqual([true])
        }  finally {
            await stopServer()
        }
    })

    await t.test('does not clear preview cache if password not supplied', async () => {
        const previewHeaders = {
            'Content-Type': 'text/plain',
        }
        const clearPreviewUrl = `http://localhost:${serverPort}/preview/clear`

        await putIntoCacheAndFile('preview/file1.txt', localFilePath + '/serverFiles/preview/file1.txt', previewModuleCache, Buffer.from('file 1 contents'))
        try {
            const response = await fetch(clearPreviewUrl, {method: 'POST', headers: previewHeaders})
            expect(response.ok).toBe(false)
            await expect(previewModuleCache.exists(`preview/file1.txt`)).resolves.toBe(true)
            await expect(fileExists(localFilePath + '/' + 'serverFiles/preview/file1.txt')).resolves.toBe(true)
        }  finally {
            await stopServer()
        }
    })

    await t.test('does not clear preview cache if invalid password supplied', async () => {
        const previewHeaders = {
            'Content-Type': 'text/plain',
            'x-preview-password': previewPassword + 'x',
        }
        const clearPreviewUrl = `http://localhost:${serverPort}/preview/clear`

        await putIntoCacheAndFile('preview/file1.txt', localFilePath + '/serverFiles/preview/file1.txt', previewModuleCache, Buffer.from('file 1 contents'))
        try {
            const response = await fetch(clearPreviewUrl, {method: 'POST', headers: previewHeaders})
            expect(response.ok).toBe(false)
            await expect(previewModuleCache.exists(`preview/file1.txt`)).resolves.toBe(true)
            await expect(fileExists(localFilePath + '/' + 'serverFiles/preview/file1.txt')).resolves.toBe(true)
        }  finally {
            await stopServer()
        }
    })
})