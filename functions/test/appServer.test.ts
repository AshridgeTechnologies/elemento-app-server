import {test} from 'node:test'
import {expect} from 'expect'
import createAppServer from '../src/appServer'
import os from 'os'
import http, {type IncomingMessage, type Server, type ServerResponse} from 'http'
import fs from 'fs'
import {type ModuleCache} from '../src/util'

const createModuleCache = (): ModuleCache & {modules:any} => ({
    modules: {},
    downloadToFile(path: string, filePath: string): Promise<boolean> {
        return Promise.resolve(!!this.modules[path])
    },
    store(path: string, text: string): Promise<void> {
        this.modules[path] = text
        return Promise.resolve()
    }
})

let dirSeq = 0
async function newModuleImportDir() {
    const moduleImportPath = `${os.tmpdir()}/appServer.test.${++dirSeq}`
    await fs.promises.rm(moduleImportPath, {force: true, recursive: true})
    return moduleImportPath
}

test('app Server', async (t) => {

    await t.test('app server runs server app from mock GitHub and caches module', async () => {
        const moduleImportPath = await newModuleImportDir()

        const gitHubRequests: string[] = []
        const requestListener = function (req: IncomingMessage, res: ServerResponse) {
            gitHubRequests.push(req.url!)
            console.log('Request', req.url)
            res.setHeader("Content-Type", "text/javascript")
            res.writeHead(200)
            res.end(serverAppCode)
        }

        const gitHubPort = 7654
        const gitHubMockServer = http.createServer(requestListener)
        await new Promise( resolve => gitHubMockServer.listen(gitHubPort, resolve as () => void))

        let server: Server | undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubServer = `http://localhost:${gitHubPort}`
            const gitHubUserConfig = { value: () => 'testuser' }
            const gitHubRepoConfig = { value: () => 'testrepo' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, moduleImportPath, gitHubUserConfig, gitHubRepoConfig, moduleCache, gitHubServer})
            server = theAppServer.listen(7655)

            const jsonResponse1 = await fetch(`http://localhost:7655/capi/ServerApp1/Plus?a=37&b=5`).then(resp => resp.json())
            expect(jsonResponse1).toBe(42)
            const jsonResponse2 = await fetch(`http://localhost:7655/capi/ServerApp1/Plus?a=99&b=1`).then(resp => resp.json())
            expect(jsonResponse2).toBe(100)
            expect(gitHubRequests).toStrictEqual(['/testuser/testrepo/main/dist/server/ServerApp1.mjs'])
            expect(moduleCache.modules[`${gitHubServer}/testuser/testrepo/main/dist/server/ServerApp1.mjs`]).toBe(serverAppCode)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).not.toBe(undefined)
        } finally {
            gitHubMockServer && await new Promise(resolve => gitHubMockServer.close(resolve as () => void))
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server runs server app from GitHub', async () => {
        const moduleImportPath = await newModuleImportDir()
        let server: Server | undefined = undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubUserConfig = { value: () => 'rileydog16' }
            const gitHubRepoConfig = { value: () => 'rabbits-4' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, moduleImportPath, gitHubUserConfig, gitHubRepoConfig, moduleCache})
            server = theAppServer.listen(7656)

            const jsonResponse = await fetch(`http://localhost:7656/capi/ServerApp1/AddTen?abc=5`).then(resp => resp.json())
            expect(jsonResponse).toBe(15)
        } finally {
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server runs server app from private repo in GitHub', async () => {
        const moduleImportPath = await newModuleImportDir()
        const gitHubAccessToken = await fs.promises.readFile('private/githubRabbits5RepoToken_finegrained.txt', 'utf8') as string
        let server: Server | undefined = undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubUserConfig = { value: () => 'rileydog16' }
            const gitHubRepoConfig = { value: () => 'rabbits-5' }
            const gitHubAccessTokenConfig = { value: () => gitHubAccessToken }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, moduleImportPath,
                gitHubUserConfig, gitHubRepoConfig, gitHubAccessTokenConfig, moduleCache})
            server = theAppServer.listen(7657)

            const jsonResponse = await fetch(`http://localhost:7657/capi/ServerApp1/AddTen?abc=5`).then(resp => resp.json())
            expect(jsonResponse).toBe(15)
        } finally {
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server stores and uses preview code from editor', async () => {
        const moduleImportPath = await newModuleImportDir()

        let server: Server | undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubServer = `http://localhost:xxxx`
            const gitHubUserConfig = { value: () => 'testuser' }
            const gitHubRepoConfig = { value: () => 'testrepo' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, moduleImportPath, gitHubUserConfig, gitHubRepoConfig, moduleCache, gitHubServer})
            server = theAppServer.listen(7658)

            await fetch(`http://localhost:7658/preview/ServerApp1.mjs`, {
                method: 'PUT',
                headers: {
                    "Content-Type": "text/plain",
                },
                body: serverAppCode})

            const jsonResponse1 = await fetch(`http://localhost:7658/@preview/capi/ServerApp1/Plus?a=37&b=5`).then(resp => resp.json())
            expect(jsonResponse1).toBe(42)
            const jsonResponse2 = await fetch(`http://localhost:7658/@preview/capi/ServerApp1/Plus?a=99&b=1`).then(resp => resp.json())
            expect(jsonResponse2).toBe(100)
            expect(moduleCache.modules[`/preview/ServerApp1.mjs`]).toBe(serverAppCode)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).not.toBe(undefined)
        } finally {
            server && await new Promise(resolve => server!.close(resolve as () => void))
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

async function Mult(c, d) {
    return c * d
}

async function Total(x, y, z) {
    return await Mult(y, await Plus(x, z))
}

async function HideMe(where) {
    return where + ' - there'
}

return {
    Plus: {func: Plus, update: false, argNames: ['a', 'b']},
    Mult: {func: Mult, update: false, argNames: ['c', 'd']},
    Total: {func: Total, update: false, argNames: ['x', 'y', 'z']}
}
}

export default ServerApp1`