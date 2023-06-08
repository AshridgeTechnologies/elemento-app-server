import {test} from 'node:test'
import {expect} from 'expect'
import createAppServer from '../src/appServer'
import os from 'os'
import http, {type IncomingMessage, type Server, type ServerResponse} from 'http'
import fs from 'fs'
import {type ModuleCache} from '../src/util'

const createModuleCache = (): ModuleCache & {modules:any} => ({
    modules: {},
    downloadToFile(path: string, _: string): Promise<boolean> {
        return Promise.resolve(!!this.modules[path])
    },
    store(path: string, text: string): Promise<void> {
        this.modules[path] = text
        return Promise.resolve()
    }
})

let dirSeq = 0
async function newModuleImportDir() {
    const localFilePath = `${os.tmpdir()}/appServer.test.${++dirSeq}`
    await fs.promises.rm(localFilePath, {force: true, recursive: true})
    return localFilePath
}

async function mockGitHub(contents: string) {
    const gitHubRequests: string[] = []
    const requestListener = function (req: IncomingMessage, res: ServerResponse) {
        gitHubRequests.push(req.url!)
        console.log('Request', req.url)
        res.setHeader('Content-Type', 'text/plain')
        res.writeHead(200)
        res.end(contents)
    }

    const gitHubPort = 7654
    const gitHubMockServer = http.createServer(requestListener)
    await new Promise(resolve => gitHubMockServer.listen(gitHubPort, resolve as () => void))
    return {gitHubRequests, gitHubPort, gitHubMockServer}
}

test('app Server', async (t) => {

    await t.test('app server runs server app on latest version from mock GitHub and caches module', async () => {
        const localFilePath = await newModuleImportDir()
        const {gitHubRequests, gitHubPort, gitHubMockServer} = await mockGitHub(serverAppCode)

        let server: Server | undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubServer = `http://localhost:${gitHubPort}`
            const gitHubUserConfig = { value: () => 'testuser' }
            const gitHubRepoConfig = { value: () => 'testrepo' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, localFilePath, gitHubUserConfig, gitHubRepoConfig, moduleCache, gitHubServer})
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

    await t.test('app server runs server app and returns error messages', async () => {
        const localFilePath = await newModuleImportDir()
        const {gitHubRequests, gitHubPort, gitHubMockServer} = await mockGitHub(serverAppCode)

        let server: Server | undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubServer = `http://localhost:${gitHubPort}`
            const gitHubUserConfig = { value: () => 'testuser' }
            const gitHubRepoConfig = { value: () => 'testrepo' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, localFilePath, gitHubUserConfig, gitHubRepoConfig, moduleCache, gitHubServer})
            server = theAppServer.listen(7665)

            const jsonResponse1 = await fetch(`http://localhost:7665/capi/ServerApp1`).then(resp => resp.json())
            expect(jsonResponse1).toStrictEqual({error: {status: 404, message: 'Not Found'}})
            const jsonResponse2 = await fetch(`http://localhost:7665/capi/ServerApp1/BadFunction`).then(resp => resp.json())
            expect(jsonResponse2).toStrictEqual({error: {status: 404, message: 'Not Found: BadFunction'}})
            const jsonResponse3 = await fetch(`http://localhost:7665/capi/ServerApp1/BlowUp?c=1&d=2`).then(resp => resp.json())
            expect(jsonResponse3).toStrictEqual({error: {status: 500, message: 'Boom!'}})
            expect(gitHubRequests).toStrictEqual(['/testuser/testrepo/main/dist/server/ServerApp1.mjs'])
            expect(moduleCache.modules[`${gitHubServer}/testuser/testrepo/main/dist/server/ServerApp1.mjs`]).toBe(serverAppCode)
        } finally {
            gitHubMockServer && await new Promise(resolve => gitHubMockServer.close(resolve as () => void))
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    const testIndexHtml = async (requestedVersion = '', githubVersion = 'main') => {
        const localFilePath = await newModuleImportDir()
        const {gitHubRequests, gitHubPort, gitHubMockServer} = await mockGitHub(indexHtml)

        let server: Server | undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubServer = `http://localhost:${gitHubPort}`
            const gitHubUserConfig = { value: () => 'testuser' }
            const gitHubRepoConfig = { value: () => 'testrepo' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, localFilePath, gitHubUserConfig, gitHubRepoConfig, moduleCache, gitHubServer})
            server = theAppServer.listen(7661)

            const response1 = await fetch(`http://localhost:7661/${requestedVersion ? requestedVersion + '/' : ''}/index.html`).then(resp => resp.text())
            expect(response1).toBe(indexHtml)
            const response2 = await fetch(`http://localhost:7661/${requestedVersion}`).then(resp => resp.text())
            expect(response2).toBe(indexHtml)
            expect(gitHubRequests).toStrictEqual([`/testuser/testrepo/${githubVersion}/dist/client/index.html`])
            expect(moduleCache.modules[`${gitHubServer}/testuser/testrepo/${githubVersion}/dist/client/index.html`]).toBe(indexHtml)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).toBe(undefined)
        } finally {
            gitHubMockServer && await new Promise(resolve => gitHubMockServer.close(resolve as () => void))
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    }
    await t.test('app server serves index.html on latest version from mock GitHub and caches module', () => testIndexHtml())
    await t.test('app server serves index.html on specified version from mock GitHub and caches module', () => testIndexHtml('@xyz123', 'xyz123'))

    let testClientJs = async (requestedVersion = '', githubVersion = 'main') => {
        const localFilePath = await newModuleImportDir()
        const {gitHubRequests, gitHubPort, gitHubMockServer} = await mockGitHub(clientApp1Js)

        let server: Server | undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubServer = `http://localhost:${gitHubPort}`
            const gitHubUserConfig = { value: () => 'testuser' }
            const gitHubRepoConfig = { value: () => 'testrepo' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, localFilePath, gitHubUserConfig, gitHubRepoConfig, moduleCache, gitHubServer})
            server = theAppServer.listen(7662)

            const response1 = await fetch(`http://localhost:7662/${requestedVersion ? requestedVersion + '/' : ''}/clientApp1.js`).then(resp => resp.text())
            expect(response1).toBe(clientApp1Js)
            expect(gitHubRequests).toStrictEqual([`/testuser/testrepo/${githubVersion}/dist/client/clientApp1.js`])
            expect(moduleCache.modules[`${gitHubServer}/testuser/testrepo/${githubVersion}/dist/client/clientApp1.js`]).toBe(clientApp1Js)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).toBe(undefined)
        } finally {
            gitHubMockServer && await new Promise(resolve => gitHubMockServer.close(resolve as () => void))
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    }
    await t.test('app server serves client js on latest version from mock GitHub and caches module', () => testClientJs())
    await t.test('app server serves client js on specified version from mock GitHub and caches module', () => testClientJs('@xyz123', 'xyz123'))

    await t.test('app server runs server app on specified version from mock GitHub and caches module', async () => {
        const localFilePath = await newModuleImportDir()
        const {gitHubRequests, gitHubPort, gitHubMockServer} = await mockGitHub(serverAppCode)

        let server: Server | undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubServer = `http://localhost:${gitHubPort}`
            const gitHubUserConfig = { value: () => 'testuser' }
            const gitHubRepoConfig = { value: () => 'testrepo' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, localFilePath, gitHubUserConfig, gitHubRepoConfig, moduleCache, gitHubServer})
            server = theAppServer.listen(7659)

            const jsonResponse1 = await fetch(`http://localhost:7659/@aabb1122/capi/ServerApp1/Plus?a=37&b=5`).then(resp => resp.json())
            expect(jsonResponse1).toBe(42)
            const jsonResponse2 = await fetch(`http://localhost:7659/@aabb1122/capi/ServerApp1/Plus?a=99&b=1`).then(resp => resp.json())
            expect(jsonResponse2).toBe(100)
            expect(gitHubRequests).toStrictEqual(['/testuser/testrepo/aabb1122/dist/server/ServerApp1.mjs'])
            expect(moduleCache.modules[`${gitHubServer}/testuser/testrepo/aabb1122/dist/server/ServerApp1.mjs`]).toBe(serverAppCode)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).not.toBe(undefined)
        } finally {
            gitHubMockServer && await new Promise(resolve => gitHubMockServer.close(resolve as () => void))
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server runs server app from GitHub', async () => {
        const localFilePath = await newModuleImportDir()
        let server: Server | undefined = undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubUserConfig = { value: () => 'rileydog16' }
            const gitHubRepoConfig = { value: () => 'rabbits-4' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, localFilePath, gitHubUserConfig, gitHubRepoConfig, moduleCache})
            server = theAppServer.listen(7656)

            const jsonResponse = await fetch(`http://localhost:7656/capi/ServerApp1/AddTen?abc=5`).then(resp => resp.json())
            expect(jsonResponse).toBe(15)
        } finally {
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server runs server app on specified version from GitHub', async () => {
        const localFilePath = await newModuleImportDir()
        let server: Server | undefined = undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubUserConfig = { value: () => 'rileydog16' }
            const gitHubRepoConfig = { value: () => 'rabbits-4' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, localFilePath, gitHubUserConfig, gitHubRepoConfig, moduleCache})
            server = theAppServer.listen(7660)

            const jsonResponse = await fetch(`http://localhost:7660/@test-version/capi/ServerApp1/AddTwenty?abc=5`).then(resp => resp.json())
            expect(jsonResponse).toBe(25)
        } finally {
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server runs server app from private repo in GitHub', async () => {
        const localFilePath = await newModuleImportDir()
        const gitHubAccessToken = await fs.promises.readFile('private/githubRabbits5RepoToken_finegrained.txt', 'utf8') as string
        let server: Server | undefined = undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubUserConfig = { value: () => 'rileydog16' }
            const gitHubRepoConfig = { value: () => 'rabbits-5' }
            const gitHubAccessTokenConfig = { value: () => gitHubAccessToken }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, localFilePath,
                gitHubUserConfig, gitHubRepoConfig, gitHubAccessTokenConfig, moduleCache})
            server = theAppServer.listen(7657)

            const jsonResponse = await fetch(`http://localhost:7657/capi/ServerApp1/AddTen?abc=5`).then(resp => resp.json())
            expect(jsonResponse).toBe(15)
        } finally {
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server stores and uses preview code from editor', async () => {
        const localFilePath = await newModuleImportDir()

        let server: Server | undefined
        try {
            const runtimeImportPath = 'http://localhost:1234/serverRuntime'
            const gitHubServer = `http://localhost:xxxx`
            const gitHubUserConfig = { value: () => 'testuser' }
            const gitHubRepoConfig = { value: () => 'testrepo' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath, localFilePath, gitHubUserConfig, gitHubRepoConfig, moduleCache, gitHubServer})
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

async function BlowUp(c, d) {
    throw new Error('Boom!')
}

async function Total(x, y, z) {
    return await Mult(y, await Plus(x, z))
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

const indexHtml = '<body>index.html</body>'

const clientApp1Js = 'function client1() {}'
