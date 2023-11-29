import {test} from 'node:test'
import {expect} from 'expect'
import {type Server} from 'http'
import * as fs from 'fs'
import {CloudStorageCache, isCacheObjectSourceModified, type ModuleCache, runtimeImportPath} from '../src/util'
import {getAccessToken, newTestDir, serverAppCode} from './testUtil'
// @ts-ignore
import admin from 'firebase-admin'
import createPreviewServer from '../src/previewServer'
import {fail} from 'assert'

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
        await moduleCache.clear('preview')
        serviceAccountKey = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'))
        firebaseAccessToken = await getAccessToken(serviceAccountKey);
        ({server, serverPort} = await makePreviewServer(localFilePath, moduleCache))
    })

    t.afterEach(stopServer)

    await t.test('deploys server app preview and updates it and serves result', async () => {

        const previewHeaders = {
            'Content-Type': 'text/plain',
            'x-firebase-access-token': firebaseAccessToken,
        }
        const putPreviewUrl = `http://localhost:${serverPort}/preview/server/ServerApp1.mjs`
        const getPreviewUrl = `http://localhost:${serverPort}/capi/preview`
        const deployTime = Date.now()
        const serverAppWithTotalFunction = serverAppCode.replace('//Totalcomment', '').replace( '// time', '// time ' + deployTime)
        try {
            await fetch(putPreviewUrl, {method: 'PUT', headers: previewHeaders, body: serverAppWithTotalFunction})

            console.log('Preview deployed')
            const tempFilePath = `${localFilePath}/temp1`
            await moduleCache.downloadToFile(`preview/server/ServerApp1.mjs`, tempFilePath)
            const fileContents = await fs.promises.readFile(tempFilePath, 'utf8')
            expect(fileContents).toBe(serverAppWithTotalFunction)
            await expect(moduleCache.exists(`preview/server/serverRuntime.cjs`)).resolves.toBe(true)
            await expect(isCacheObjectSourceModified(`${runtimeImportPath}/serverRuntime.cjs`, 'preview/server/serverRuntime.cjs', moduleCache)).resolves.toBe(false)
            // different source url, so expect modified
            await expect(isCacheObjectSourceModified(`${runtimeImportPath}/runtime.js`, 'preview/server/serverRuntime.cjs', moduleCache)).resolves.toBe(true)
            // file with no etag, so expect modified
            await expect(isCacheObjectSourceModified(`${runtimeImportPath}/serverRuntime.cjs`, 'preview/server/ServerApp1.mjs', moduleCache)).resolves.toBe(true)

            const apiResult = await fetch(`${getPreviewUrl}/ServerApp1/Total?x=20&y=30&z=40`).then(resp => resp.json() )
            expect(apiResult).toBe(90)

            const serverAppWithDifference = serverAppCode.replace('//Differencecomment', '').replace( '// time', '// time ' + deployTime)
            await fetch(putPreviewUrl, {method: 'PUT', headers: previewHeaders, body: serverAppWithDifference})
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
        const putPreviewUrl = `http://localhost:${serverPort}/preview/server/ServerApp1.mjs`
        try {
            const response = await fetch(putPreviewUrl, {method: 'PUT', headers: previewHeaders, body: serverAppCode})
            expect(response.ok).toBe(false)
            // fail('Preview deployed with invalid access token - should not be')
        }  finally {
            await stopServer()
        }
    })
})
