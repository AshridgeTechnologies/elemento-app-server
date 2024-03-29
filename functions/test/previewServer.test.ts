import {test} from 'node:test'
import {expect} from 'expect'
import {type Server} from 'http'
import * as fs from 'fs'
import {bufferFromJson, fileExists, putIntoCacheAndFile} from '../src/util'
import {newTestDir, serverAppCode} from './testUtil'
// @ts-ignore
import admin from 'firebase-admin'
import createPreviewServer from '../src/previewServer'
import {CloudStorageCache, ModuleCache} from '../src/CloudStorageCache'
import {getStorage} from 'firebase-admin/storage'

async function makePreviewServer(localFilePath: string, moduleCache: ModuleCache, settingsStore: ModuleCache) {
    const serverPort = 7656
    const theAppServer = await createPreviewServer({localFilePath, moduleCache, settingsStore})
    const server = theAppServer.listen(serverPort)
    return {serverPort, server}
}

let seq = 1
async function cachedFileContents(path: string, localFilePath: string, moduleCache: ModuleCache) {
    const tempFilePath = `${localFilePath}/temp${seq++}`
    await moduleCache.downloadToFile(path, tempFilePath)
    return await fs.promises.readFile(tempFilePath, 'utf8')
}


const firebaseProject = 'elemento-hosting-test'
const bucketName = `${firebaseProject}.appspot.com`
const serviceAccountKeyPath = 'private/elemento-hosting-test-firebase-adminsdk-7en27-f3397ab7af.json'
const serviceAccountKey = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'))
admin.initializeApp({credential: admin.credential.cert(serviceAccountKey), storageBucket: bucketName})
const previewPassword = 'pass' + Date.now()
const validPreviewHeaders = {
    'Content-Type': 'text/plain',
    'x-preview-password': previewPassword,
}

test('preview Server', async (t) => {

    let localFilePath: string
    let moduleCache = new CloudStorageCache('previewCache')
    let settingsStore = new CloudStorageCache('settings')

    let server: Server | undefined, serverPort: number | undefined
    const stopServer = async () => server && await new Promise(resolve => server!.close(resolve as () => void))

    t.before(async () => {
        await settingsStore.store('.settings.json', bufferFromJson({previewPassword}))
    })

    t.beforeEach(async () => {
        localFilePath = await newTestDir('previewServer');
        await moduleCache.clear();
        ({server, serverPort} = await makePreviewServer(localFilePath, moduleCache, settingsStore))
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
        const getPreviewUrl = `http://localhost:${serverPort}/capi/preview`
        const deployTime = Date.now()
        const serverAppWithTotalFunction = serverAppCode.replace('//Totalcomment', '').replace( '// time', '// time ' + deployTime)
        const serverAppPath = 'server/ServerApp1.mjs'
        const body1 = `//// File: ${serverAppPath}\n${serverAppWithTotalFunction}\n//// End of file\n`
                        + `//// File: file2.txt\nSome text\n//// End of file\n`

        const cachedFile = (path: string) => cachedFileContents(path, localFilePath, moduleCache)

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

        await putIntoCacheAndFile('preview/file1.txt', localFilePath + '/serverFiles/preview/file1.txt', moduleCache, Buffer.from('file 1 contents'))
        await putIntoCacheAndFile('deploy1/file2.txt', localFilePath + '/serverFiles/deploy1/file2.txt', moduleCache, Buffer.from('file 2 contents'))
        const otherFile = getStorage().bucket().file('previewCache' + '_not' + '/'+ 'otherFile.txt')
        await otherFile.save('other file')
        try {
            const response = await fetch(clearPreviewUrl, {method: 'POST', headers: validPreviewHeaders})
            expect(response.ok).toBe(true)
            await expect(moduleCache.exists(`deploy1/file2.txt`)).resolves.toBe(false)
            await expect(moduleCache.exists(`preview/file1.txt`)).resolves.toBe(false)
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

        await putIntoCacheAndFile('preview/file1.txt', localFilePath + '/serverFiles/preview/file1.txt', moduleCache, Buffer.from('file 1 contents'))
        try {
            const response = await fetch(clearPreviewUrl, {method: 'POST', headers: previewHeaders})
            expect(response.ok).toBe(false)
            await expect(moduleCache.exists(`preview/file1.txt`)).resolves.toBe(true)
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

        await putIntoCacheAndFile('preview/file1.txt', localFilePath + '/serverFiles/preview/file1.txt', moduleCache, Buffer.from('file 1 contents'))
        try {
            const response = await fetch(clearPreviewUrl, {method: 'POST', headers: previewHeaders})
            expect(response.ok).toBe(false)
            await expect(moduleCache.exists(`preview/file1.txt`)).resolves.toBe(true)
            await expect(fileExists(localFilePath + '/' + 'serverFiles/preview/file1.txt')).resolves.toBe(true)
        }  finally {
            await stopServer()
        }
    })


})
