import {test} from 'node:test'
import {expect} from 'expect'
import {type Server} from 'http'
import axios from 'axios'
import {createModuleCache, makeServer, newTestDir, serverAppCode} from './testUtil'
import {ModuleCache} from '../src/CloudStorageCache'

const runtimeImportPath = 'http://127.0.0.1:8000/lib'

const fetchJson = (url: string) => fetch(url, {headers: { Accept: 'application/json'}}).then(resp => {
    expect(resp.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    return resp.json()
})

test('app Server', async (t) => {

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
        localFilePath = await newTestDir('appServer')
        previewLocalFilePath = await newTestDir('previewServer')
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
