import {test} from 'node:test'
import {expect} from 'expect'
import createAppServer from '../src/appServer'
import * as os from 'os'
import {type Server} from 'http'
import * as fs from 'fs'
import * as path from 'path'
import {type ModuleCache} from '../src/util'
import createAdminServer from '../src/adminServer'

const runtimeImportPath = 'http://127.0.0.1:8000/lib'
const runtimeImportPathParam = {value: () => 'http://127.0.0.1:8000/lib'}

const createModuleCache = (): ModuleCache & {modules:any} => ({
    modules: {},
    downloadToFile(cachePath: string, localPath: string): Promise<boolean> {
        if (this.modules[cachePath]) {
            const dir = path.dirname(localPath)
            return fs.promises.mkdir(dir, {recursive: true})
                    .then( () => fs.promises.writeFile(localPath, this.modules[cachePath]))
                    .then( () => true )
        }
        return Promise.resolve(false)
    },
    store(path: string, contents: Buffer): Promise<void> {
        this.modules[path] = contents
        return Promise.resolve()
    },
    clear() {
        this.modules = {}
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
    const theAppServer = await createAppServer({runtimeImportPath: runtimeImportPathParam, localFilePath, moduleCache})
    const server = theAppServer.listen(serverPort)
    return {serverPort, server}
}

async function makeAdminServer(localFilePath: string, moduleCache: ModuleCache & { modules: any }) {
    const serverPort = 7656
    const theAdminServer = await createAdminServer({localFilePath, moduleCache})
    const server = theAdminServer.listen(serverPort)
    return {serverPort, server}
}

test('app Server', async (t) => {

    let localFilePath: string
    let moduleCache = createModuleCache()
    let testVersion = 'abcd1234'
    let server: Server | undefined, serverPort: number | undefined
    let adminServer: Server | undefined, adminServerPort: number | undefined

    t.beforeEach( async () => {
        localFilePath = await newModuleImportDir()
        moduleCache = createModuleCache()
        await moduleCache.store(`${testVersion}/server/ServerApp1.mjs`, Buffer.from(serverAppCode));
        ({server, serverPort} = await makeAppServer(localFilePath, moduleCache))
    })

    const stopServer = async () => server && await new Promise(resolve => server!.close(resolve as () => void))
    const stopAdminServer = async () => adminServer && await new Promise(resolve => adminServer!.close(resolve as () => void))

    await t.test('app server runs server app on given version and caches module', async () => {

        try {
            expect(await fetchJson(`http://localhost:${serverPort}/capi/${testVersion}/ServerApp1/Plus?a=37&b=5`)).toBe(42)
            expect(await fetchJson(`http://localhost:${serverPort}/capi/${testVersion}/ServerApp1/Plus?a=99&b=1`)).toBe(100)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).not.toBe(undefined)
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

    await t.test('app server stores and uses preview code from editor', async () => {
        ({server: adminServer, serverPort: adminServerPort} = await makeAdminServer(localFilePath, moduleCache))
        const serverAppWithTotalFunction = serverAppCode.replace('//Totalcomment', '')
        try {
            await fetch(`http://localhost:${adminServerPort}/preview/server/ServerApp1.mjs`, {
                method: 'PUT',
                headers: {
                    "Content-Type": "text/plain",
                },
                body: serverAppWithTotalFunction})

            expect(await fetchJson(`http://localhost:${serverPort}/capi/preview/ServerApp1/Total?x=2&y=3&z=4`)).toBe(9)
            expect(moduleCache.modules[`/preview/server/ServerApp1.mjs`].toString()).toBe(serverAppWithTotalFunction)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).not.toBe(undefined)
        } finally {
            await stopServer()
            await stopAdminServer()
        }
    })
})

const serverAppCode = `import serverRuntime from './serverRuntime.cjs'
const {globalFunctions} = serverRuntime
const {types} = serverRuntime

const {Sum} = globalFunctions
const {ChoiceType, DateType, ListType, NumberType, RecordType, TextType, TrueFalseType, Rule} = types

// Types1.js
const Name = new TextType('Name', {required: true, maxLength: 20})

const Types1 = {
    Name
}

// Types2.js
const ItemAmount = new NumberType('Item Amount', {required: false, max: 10})

const Types2 = {
    ItemAmount
}


const ServerApp1 = (user) => {

function CurrentUser() { return runtimeFunctions.asCurrentUser(user) }

async function Plus(a, b) {
    return Sum(a, b)
}

async function BlowUp(c, d) {
    throw new Error('Boom!')
}

async function Total(x, y, z) {
    return //Totalcomment await Plus(y, await Plus(x, z))
}

async function HideMe(where) {
    return where + ' - there'
}

return {
    Plus: {func: Plus, update: false, argNames: ['a', 'b']},
    BlowUp: {func: BlowUp, update: false, argNames: ['c', 'd']},
    Total: {func: Total, update: false, argNames: ['x', 'y', 'z']}
}
}

export default ServerApp1`
