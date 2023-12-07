import {test} from 'node:test'
import {expect} from 'expect'
import {type Server} from 'http'
import * as fs from 'fs'
import {fileExists, isCacheObjectSourceModified, type ModuleCache, putIntoCacheAndFile, runtimeImportPath} from '../src/util'
import {getAccessToken, newTestDir, serverAppCode} from './testUtil'
// @ts-ignore
import admin from 'firebase-admin'
import createPreviewServer from '../src/previewServer'
import {CloudStorageCache} from '../src/CloudStorageCache'

async function makePreviewServer(localFilePath: string, moduleCache: ModuleCache) {
    const serverPort = 7656
    const theAppServer = await createPreviewServer({localFilePath, moduleCache})
    const server = theAppServer.listen(serverPort)
    return {serverPort, server}
}

const firebaseProject = 'elemento-hosting-test'
const bucketName = `${firebaseProject}.appspot.com`
const serviceAccountKeyPath = 'private/elemento-hosting-test-firebase-adminsdk-7en27-f3397ab7af.json'
const serviceAccountKey = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'))
admin.initializeApp({credential: admin.credential.cert(serviceAccountKey), storageBucket: bucketName})

test('preview Server', async (t) => {

    let localFilePath: string
    let moduleCache = new CloudStorageCache()
    let serviceAccountKey: string, firebaseAccessToken: string

    let server: Server | undefined, serverPort: number | undefined
    const stopServer = async () => server && await new Promise(resolve => server!.close(resolve as () => void))

    t.beforeEach(async () => {
        localFilePath = await newTestDir();
        serviceAccountKey = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'))
        firebaseAccessToken = await getAccessToken(serviceAccountKey);
        await moduleCache.clear(firebaseAccessToken, 'preview');
        ({server, serverPort} = await makePreviewServer(localFilePath, moduleCache))
    })

    t.afterEach(stopServer)

    await t.test('deploys server app preview and updates it and serves result', async () => {

        const previewHeaders = {
            'Content-Type': 'text/plain',
            'x-firebase-access-token': firebaseAccessToken,
        }
        const putPreviewUrl = `http://localhost:${serverPort}/preview`
        const getPreviewUrl = `http://localhost:${serverPort}/capi/preview`
        const deployTime = Date.now()
        const serverAppWithTotalFunction = serverAppCode.replace('//Totalcomment', '').replace( '// time', '// time ' + deployTime)
        const serverAppPath = 'server/ServerApp1.mjs'
        const body1 = `//// File: ${serverAppPath}\n${serverAppWithTotalFunction}\n//// End of file\n`
                        + `//// File: file2.txt\nSome text\n//// End of file\n`

        let seq = 1
        async function cachedFileContents(path: string) {
            const tempFilePath = `${localFilePath}/temp${seq++}`
            await moduleCache.downloadToFile(path, tempFilePath)
            return await fs.promises.readFile(tempFilePath, 'utf8')
        }


        try {
            await fetch(putPreviewUrl, {method: 'PUT', headers: previewHeaders, body: body1})

            console.log('Preview deployed')
            expect(await cachedFileContents(`preview/server/ServerApp1.mjs`)).toBe(serverAppWithTotalFunction)
            expect(await cachedFileContents(`preview/file2.txt`)).toBe('Some text')
            await expect(moduleCache.exists(`preview/server/serverRuntime.cjs`)).resolves.toBe(true)
            await expect(isCacheObjectSourceModified(`${runtimeImportPath}/serverRuntime.cjs`, 'preview/server/serverRuntime.cjs', moduleCache)).resolves.toBe(false)
            // different source url, so expect modified
            await expect(isCacheObjectSourceModified(`${runtimeImportPath}/runtime.js`, 'preview/server/serverRuntime.cjs', moduleCache)).resolves.toBe(true)
            // file with no etag, so expect modified
            await expect(isCacheObjectSourceModified(`${runtimeImportPath}/serverRuntime.cjs`, 'preview/server/ServerApp1.mjs', moduleCache)).resolves.toBe(true)

            const apiResult = await fetch(`${getPreviewUrl}/ServerApp1/Total?x=20&y=30&z=40`).then(resp => resp.json() )
            expect(apiResult).toBe(90)

            const serverAppWithDifference = serverAppCode.replace('//Differencecomment', '').replace( '// time', '// time ' + deployTime)
            const body2 = `//// File: ${serverAppPath}\n${serverAppWithDifference}\n//// End of file`
            await fetch(putPreviewUrl, {method: 'PUT', headers: previewHeaders, body: body2})
            const resp = await fetch(`${getPreviewUrl}/ServerApp1/Difference?x=20&y=30`)
            const differenceResult = await resp.json()
            expect(differenceResult).toBe(-10)
        } finally {
            await stopServer()
        }
    })

    await t.test('does not deploy server app preview if invalid access token supplied', async () => {

        const previewHeaders = {
            'Content-Type': 'text/plain',
            'x-firebase-access-token': firebaseAccessToken.substring(0, 50) + 'xxx' + firebaseAccessToken.substring(53),
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

    await t.test('clears preview cache but leaves other areas', async () => {
        const previewHeaders = {
            'Content-Type': 'text/plain',
            'x-firebase-access-token': firebaseAccessToken,
        }
        const clearPreviewUrl = `http://localhost:${serverPort}/clearpreview`

        await putIntoCacheAndFile('preview/file1.txt', localFilePath + '/serverFiles/preview/file1.txt', moduleCache, Buffer.from('file 1 contents'), firebaseAccessToken)
        await putIntoCacheAndFile('deploy1/file2.txt', localFilePath + '/serverFiles/deploy1/file2.txt', moduleCache, Buffer.from('file 2 contents'), firebaseAccessToken)
        try {
            const response = await fetch(clearPreviewUrl, {method: 'POST', headers: previewHeaders})
            expect(response.ok).toBe(true)
            await expect(moduleCache.exists(`deploy1/file2.txt`)).resolves.toBe(true)
            await expect(moduleCache.exists(`preview/file1.txt`)).resolves.toBe(false)
            await expect(fileExists(localFilePath + '/' + 'serverFiles/deploy1/file2.txt')).resolves.toBe(true)
            await expect(fileExists(localFilePath + '/' + 'serverFiles/preview/file1.txt')).resolves.toBe(false)
        }  finally {
            await stopServer()
        }
    })

    await t.test('does not clear preview cache if access token not supplied', async () => {
        const previewHeaders = {
            'Content-Type': 'text/plain',
        }
        const clearPreviewUrl = `http://localhost:${serverPort}/clearpreview`

        await putIntoCacheAndFile('preview/file1.txt', localFilePath + '/serverFiles/preview/file1.txt', moduleCache, Buffer.from('file 1 contents'), firebaseAccessToken)
        try {
            const response = await fetch(clearPreviewUrl, {method: 'POST', headers: previewHeaders})
            expect(response.ok).toBe(false)
            await expect(moduleCache.exists(`preview/file1.txt`)).resolves.toBe(true)
            await expect(fileExists(localFilePath + '/' + 'serverFiles/preview/file1.txt')).resolves.toBe(true)
        }  finally {
            await stopServer()
        }
    })

    await t.test('does not clear preview cache if invalid access token supplied', async () => {
        const previewHeaders = {
            'Content-Type': 'text/plain',
            'x-firebase-access-token': firebaseAccessToken.substring(0, 50) + 'xxx' + firebaseAccessToken.substring(53),
        }
        const clearPreviewUrl = `http://localhost:${serverPort}/clearpreview`

        await putIntoCacheAndFile('preview/file1.txt', localFilePath + '/serverFiles/preview/file1.txt', moduleCache, Buffer.from('file 1 contents'), firebaseAccessToken)
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
