import {test} from 'node:test'
import {expect} from 'expect'
import createAppServer, {GITHUB_RAW} from '../src/appServer'
import * as os from 'os'
import * as http from 'http'
import {type IncomingMessage, type Server, type ServerResponse} from 'http'
import * as fs from 'fs'
import {type ModuleCache} from '../src/util'

const runtimeImportPath = 'http://127.0.0.1:8000/lib'
const runtimeImportPathParam = {value: () => 'http://127.0.0.1:8000/lib'}

const createModuleCache = (): ModuleCache & {modules:any} => ({
    modules: {},
    downloadToFile(path: string, _: string): Promise<boolean> {
        return Promise.resolve(!!this.modules[path])
    },
    store(path: string, text: string): Promise<void> {
        this.modules[path] = text
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

const gitHubPort = 7654
const gitHubServer = `http://localhost:${gitHubPort}`

async function mockGitHub(contents: string) {
    const gitHubRequests: string[] = []
    const requestListener = function (req: IncomingMessage, res: ServerResponse) {
        gitHubRequests.push(req.url!)
        console.log('Request', req.url)
        res.setHeader('Content-Type', 'text/plain')
        res.writeHead(200)
        res.end(contents)
    }

    const gitHubMockServer = http.createServer(requestListener)
    await new Promise(resolve => gitHubMockServer.listen(gitHubPort, resolve as () => void))
    return {gitHubRequests, gitHubMockServer}
}

const fetchJson = (url: string) => fetch(url).then(resp => resp.json())
const fetchText = (url: string) => fetch(url).then(resp => resp.text())

async function makeAppServer(localFilePath: string,
                             gitHubUser: string,
                             gitHubRepo: string,
                             moduleCache: ModuleCache & { modules: any },
                             gitHubServer?: string) {
    const serverPort = 7655
    const gitHubUserConfig = { value: () => 'testuser' }
    const gitHubRepoConfig = { value: () => 'testrepo' }
    const theAppServer = await createAppServer({
        runtimeImportPath: runtimeImportPathParam,
        localFilePath,
        gitHubUserConfig,
        gitHubRepoConfig,
        moduleCache,
        gitHubServer
    })
    const server = theAppServer.listen(7655)
    return {serverPort, server}
}

test('app Server', async (t) => {

    let localFilePath: string
    let moduleCache = createModuleCache()
    let server: Server | undefined, serverPort: number | undefined

    t.beforeEach( async () => {
        localFilePath = await newModuleImportDir()
        moduleCache = createModuleCache()
        server = undefined
        serverPort = undefined
    })

    await t.test('app server runs server app on latest version from mock GitHub and caches module', async () => {
        const {gitHubRequests, gitHubMockServer} = await mockGitHub(serverAppCode);
        ({server, serverPort} = await makeAppServer(localFilePath, 'testuser', 'testrepo', moduleCache, gitHubServer))

        try {
            expect(await fetchJson(`http://localhost:${serverPort}/capi/ServerApp1/Plus?a=37&b=5`)).toBe(42)
            expect(await fetchJson(`http://localhost:${serverPort}/capi/ServerApp1/Plus?a=99&b=1`)).toBe(100)
            expect(gitHubRequests).toStrictEqual(['/testuser/testrepo/main/dist/server/ServerApp1.mjs'])
            expect(moduleCache.modules[`${gitHubServer}/testuser/testrepo/main/dist/server/ServerApp1.mjs`]).toBe(serverAppCode)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).not.toBe(undefined)
        } finally {
            gitHubMockServer && await new Promise(resolve => gitHubMockServer.close(resolve as () => void))
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server runs server app and returns error messages', async () => {
        const {gitHubRequests, gitHubMockServer} = await mockGitHub(serverAppCode);
        ({server, serverPort} = await makeAppServer(localFilePath, 'testuser', 'testrepo', moduleCache, gitHubServer))

        try {
            expect(await fetchJson(`http://localhost:${serverPort}/capi/ServerApp1`)).toStrictEqual({error: {status: 404, message: 'Not Found'}})
            expect(await fetchJson(`http://localhost:${serverPort}/capi/ServerApp1/BadFunction`)).toStrictEqual({error: {status: 404, message: 'Not Found: BadFunction'}})
            expect(await fetchJson(`http://localhost:${serverPort}/capi/ServerApp1/BlowUp?c=1&d=2`)).toStrictEqual({error: {status: 500, message: 'Boom!'}})
            expect(gitHubRequests).toStrictEqual(['/testuser/testrepo/main/dist/server/ServerApp1.mjs'])
            expect(moduleCache.modules[`${gitHubServer}/testuser/testrepo/main/dist/server/ServerApp1.mjs`]).toBe(serverAppCode)
        } finally {
            gitHubMockServer && await new Promise(resolve => gitHubMockServer.close(resolve as () => void))
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    const testIndexHtml = async (requestedVersion = '', githubVersion = 'main') => {
        const {gitHubRequests, gitHubMockServer} = await mockGitHub(indexHtml);
        ({server, serverPort} = await makeAppServer(localFilePath, 'testuser', 'testrepo', moduleCache, gitHubServer))
        const requestedVersionSegment = requestedVersion ? requestedVersion + '/' : ''

        try {
            expect(await fetchText(`http://localhost:${serverPort}/${requestedVersionSegment}NewApp/index.html`)).toBe(indexHtml)
            expect(await fetchText(`http://localhost:${serverPort}/${requestedVersionSegment}NewApp`)).toBe(indexHtml)
            expect(await fetchText(`http://localhost:${serverPort}/${requestedVersionSegment}NewApp/`)).toBe(indexHtml)
            expect(gitHubRequests).toStrictEqual([`/testuser/testrepo/${githubVersion}/dist/client/NewApp/index.html`])
            expect(moduleCache.modules[`${gitHubServer}/testuser/testrepo/${githubVersion}/dist/client/NewApp/index.html`]).toBe(indexHtml)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).toBe(undefined)
        } finally {
            gitHubMockServer && await new Promise(resolve => gitHubMockServer.close(resolve as () => void))
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    }
    await t.test('app server serves index.html on latest version from mock GitHub and caches module', () => testIndexHtml())
    await t.test('app server serves index.html on specified version from mock GitHub and caches module', () => testIndexHtml('@xyz123', 'xyz123'))

    let testClientJs = async (requestedVersion = '', githubVersion = 'main') => {
        const {gitHubRequests, gitHubMockServer} = await mockGitHub(clientApp1Js);
        ({server, serverPort} = await makeAppServer(localFilePath, 'testuser', 'testrepo', moduleCache, gitHubServer))

        try {
            expect(await fetchText(`http://localhost:${serverPort}/${requestedVersion ? requestedVersion + '/' : ''}NewApp/clientApp1.js`)).toBe(clientApp1Js)
            expect(gitHubRequests).toStrictEqual([`/testuser/testrepo/${githubVersion}/dist/client/NewApp/clientApp1.js`])
            expect(moduleCache.modules[`${gitHubServer}/testuser/testrepo/${githubVersion}/dist/client/NewApp/clientApp1.js`]).toBe(clientApp1Js)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).toBe(undefined)
        } finally {
            gitHubMockServer && await new Promise(resolve => gitHubMockServer.close(resolve as () => void))
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    }
    await t.test('app server serves client js on latest version from mock GitHub and caches module', () => testClientJs())
    await t.test('app server serves client js on specified version from mock GitHub and caches module', () => testClientJs('@xyz123', 'xyz123'))

    await t.test('app server runs server app on specified version from mock GitHub and caches module', async () => {
        const {gitHubRequests, gitHubMockServer} = await mockGitHub(serverAppCode);
        ({server, serverPort} = await makeAppServer(localFilePath, 'testuser', 'testrepo', moduleCache, gitHubServer))

        try {
            expect(await fetchJson(`http://localhost:${serverPort}/@aabb1122/capi/ServerApp1/Plus?a=37&b=5`)).toBe(42)
            expect(await fetchJson(`http://localhost:${serverPort}/@aabb1122/capi/ServerApp1/Plus?a=99&b=1`)).toBe(100)
            expect(gitHubRequests).toStrictEqual(['/testuser/testrepo/aabb1122/dist/server/ServerApp1.mjs'])
            expect(moduleCache.modules[`${gitHubServer}/testuser/testrepo/aabb1122/dist/server/ServerApp1.mjs`]).toBe(serverAppCode)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).not.toBe(undefined)
        } finally {
            gitHubMockServer && await new Promise(resolve => gitHubMockServer.close(resolve as () => void))
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server runs server app from GitHub', async () => {
        let server: Server | undefined = undefined
        try {
            const gitHubUserConfig = { value: () => 'rileydog16' }
            const gitHubRepoConfig = { value: () => 'rabbits-4' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath: runtimeImportPathParam, localFilePath, gitHubUserConfig, gitHubRepoConfig, moduleCache, gitHubServer: GITHUB_RAW})
            server = theAppServer.listen(7656)

            expect(await fetchJson(`http://localhost:7656/capi/ServerApp1/AddTen?abc=5`)).toBe(15)
        } finally {
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server runs server app on specified version from GitHub', async () => {
        let server: Server | undefined = undefined
        try {
            const gitHubUserConfig = { value: () => 'rileydog16' }
            const gitHubRepoConfig = { value: () => 'rabbits-4' }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath: runtimeImportPathParam, localFilePath, gitHubUserConfig, gitHubRepoConfig, moduleCache, gitHubServer: GITHUB_RAW})
            server = theAppServer.listen(7660)

            expect(await fetchJson(`http://localhost:7660/@test-version/capi/ServerApp1/AddTwenty?abc=5`)).toBe(25)
        } finally {
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server runs server app from private repo in GitHub', async () => {
        const gitHubAccessToken = await fs.promises.readFile('private/githubRabbits5RepoToken_finegrained.txt', 'utf8') as string
        let server: Server | undefined = undefined
        try {
            const gitHubUserConfig = { value: () => 'rileydog16' }
            const gitHubRepoConfig = { value: () => 'rabbits-5' }
            const gitHubAccessTokenConfig = { value: () => gitHubAccessToken }
            const moduleCache = createModuleCache()

            const theAppServer = await createAppServer({runtimeImportPath: runtimeImportPathParam, localFilePath,
                gitHubUserConfig, gitHubRepoConfig, gitHubAccessTokenConfig, moduleCache, gitHubServer: GITHUB_RAW})
            server = theAppServer.listen(7657)

            expect(await fetchJson(`http://localhost:7657/capi/ServerApp1/AddTen?abc=5`)).toBe(15)
        } finally {
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })

    await t.test('app server stores and uses preview code from editor', async () => {
        const {gitHubMockServer} = await mockGitHub(serverAppCode);
        ({server, serverPort} = await makeAppServer(localFilePath, 'testuser', 'testrepo', moduleCache, gitHubServer))

        try {
            await fetch(`http://localhost:${serverPort}/preview/ServerApp1.mjs`, {
                method: 'PUT',
                headers: {
                    "Content-Type": "text/plain",
                },
                body: serverAppCode})

            expect(await fetchJson(`http://localhost:${serverPort}/@preview/capi/ServerApp1/Plus?a=37&b=5`)).toBe(42)
            expect(await fetchJson(`http://localhost:${serverPort}/@preview/capi/ServerApp1/Plus?a=99&b=1`)).toBe(100)
            expect(moduleCache.modules[`/preview/ServerApp1.mjs`]).toBe(serverAppCode)
            expect(moduleCache.modules[`${runtimeImportPath}/serverRuntime.cjs`]).not.toBe(undefined)
        } finally {
            gitHubMockServer && await new Promise(resolve => gitHubMockServer.close(resolve as () => void))
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
