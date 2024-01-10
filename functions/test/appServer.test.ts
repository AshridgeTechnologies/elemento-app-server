import {test} from 'node:test'
import {expect} from 'expect'
import createAppServer from '../src/appServer'
import * as os from 'os'
import {type Server} from 'http'
import * as fs from 'fs'
import axios from 'axios'
import {serverAppCode} from './testUtil'
import {ModuleCache} from '../src/CloudStorageCache'

const runtimeImportPath = 'http://127.0.0.1:8000/lib'
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

async function makeAppServer(localFilePath: string, moduleCache: ModuleCache & { modules: any }) {
    const serverPort = 7655
    const theAppServer = await createAppServer({localFilePath, moduleCache})
    const server = theAppServer.listen(serverPort)
    return {serverPort, server}
}
test('app Server', async (t) => {

    let localFilePath: string
    let moduleCache = createModuleCache()
    let testVersion = 'abcd1234'
    let server: Server | undefined, serverPort: number | undefined
    const serverRuntimeBuffer: Buffer = await axios.get(`${runtimeImportPath}/serverRuntime.cjs`, {responseType: 'arraybuffer'}).then( resp => resp.data )

    const stopServer = async () => server && await new Promise(resolve => server!.close(resolve as () => void))

    t.beforeEach( async () => {
        localFilePath = await newModuleImportDir()
        moduleCache = createModuleCache()
        await moduleCache.store(`${testVersion}/server/ServerApp1.mjs`, Buffer.from(serverAppCode), 'abc123');
        await moduleCache.store(`${testVersion}/server/serverRuntime.cjs`, serverRuntimeBuffer, 'abc123');
        ({server, serverPort} = await makeAppServer(localFilePath, moduleCache))
    })

    await t.test('app server runs server app on given version from cached module', async () => {

        try {
            expect(await fetchJson(`http://localhost:${serverPort}/capi/${testVersion}/ServerApp1/Plus?a=37&b=5`)).toBe(42)
            expect(await fetchJson(`http://localhost:${serverPort}/capi/${testVersion}/ServerApp1/Plus?a=99&b=1`)).toBe(100)
        } finally {
            await stopServer()
        }
    })

    await t.test('app server runs server app and returns error messages', async () => {
        try {
            expect(await fetchJson(`http://localhost:${serverPort}/capi/${testVersion}/ServerApp1`)).toStrictEqual({error: {status: 404, message: 'Not Found'}})
            expect(await fetchJson(`http://localhost:${serverPort}/capi/${testVersion}/ServerApp1/BadFunction`)).toStrictEqual({error: {status: 404, message: 'Not Found: BadFunction'}})
            expect(await fetchJson(`http://localhost:${serverPort}/capi/${testVersion}/ServerApp1/BlowUp?c=1&d=2`)).toStrictEqual({error: {status: 500, message: 'Boom!'}})
        } finally {
            await stopServer()
        }
    })
})
