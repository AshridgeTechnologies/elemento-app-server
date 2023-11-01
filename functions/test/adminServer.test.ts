import {test} from 'node:test'
import {expect} from 'expect'
import * as os from 'os'
import {type Server} from 'http'
import * as fs from 'fs'
import {type ModuleCache} from '../src/util'
import createAdminServer from '../src/adminServer'
import {getAccessToken} from './testUtil'

const createModuleCache = (): ModuleCache & {modules:any} => ({
    modules: {},
    downloadToFile(path: string, _: string): Promise<boolean> {
        return Promise.resolve(!!this.modules[path])
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
async function newTestDir() {
    const localFilePath = `${os.tmpdir()}/adminServer.test.${++dirSeq}`
    await fs.promises.rm(localFilePath, {force: true, recursive: true}).then(() => fs.promises.mkdir(localFilePath, {recursive: true}))
    return localFilePath
}

const gitHubPort = 7654
const fetchJson = (url: string) => fetch(url, {headers: { Accept: 'application/json'}}).then(resp => {
    expect(resp.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    return resp.json()
})

async function makeAdminServer(localFilePath: string) {
    const serverPort = 7655
    const theAppServer = await createAdminServer({localFilePath})
    const server = theAppServer.listen(7655)
    return {serverPort, server}
}

test('admin Server', async (t) => {

    let localFilePath: string
    let moduleCache = createModuleCache()
    let server: Server | undefined, serverPort: number | undefined

    t.beforeEach(async () => {
        localFilePath = await newTestDir()
        moduleCache = createModuleCache()
        server = undefined
        serverPort = undefined
    })

    await t.test('deploys client-only project from GitHub', async () => {
        ({server, serverPort} = await makeAdminServer(localFilePath))

        const gitHubAccessToken = await fs.promises.readFile('private/Elemento-Test-1RepoToken_finegrained.txt', 'utf8')
        const serviceAccountKey = JSON.parse(fs.readFileSync('private/elemento-hosting-test-firebase-adminsdk-7en27-f3397ab7af.json', 'utf8'))
        const googleAccessToken = await getAccessToken(serviceAccountKey)

        const requestData = {
            firebaseProject: 'elemento-hosting-test',
            username: 'rileydog16',
            repo: 'Elemento-Test-1'
        }
        const headers = {
            'Content-Type': 'application/json',
            'X-Google-Access-Token': googleAccessToken,
            'X-GitHub-Access-Token': gitHubAccessToken,
        }

        const deployUrl = `http://localhost:${serverPort}/deploy`
        try {
            const deployResult = await fetch(deployUrl, {method: 'POST', headers, body: JSON.stringify(requestData)}).then( resp => resp.json() )
            console.log('Deployed')
            const {releaseTime} = deployResult
            const releaseTimeMillis = new Date(releaseTime).getTime()
            expect(releaseTimeMillis - Date.now()).toBeLessThan(5000)

            const htmlPage = await fetch('https://elemento-hosting-test.web.app/MainApp').then( resp => resp.text() )
            expect(htmlPage).toContain('<title>Main App</title>')
        } finally {
            server && await new Promise(resolve => server!.close(resolve as () => void))
        }
    })
})

/*
To do
  - New test project
  - Save to new private repo in rileydog
  - Get access token for repo
  - Get service account key for elemento-hosting-test
  - Convert key into access token
  - Import access tokens into test
  - Run and try result manually
  - Return status from POST call, check in test
  - Check get index.html
- Put version file into deployment and test
 */