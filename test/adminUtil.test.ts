import {test} from 'node:test'
import {deployToHosting} from '../src/adminUtil'
import * as fs from 'fs'
import * as os from 'os'
import {getAccessToken, initializeApp} from './testUtil'
import {CloudStorageCache} from '../src/CloudStorageCache'

const {firebaseProject, serviceAccountKeyPath} = initializeApp()

test('admin util', async (t) => {
    const serviceAccountKey = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'))
    const firebaseAccessToken = await getAccessToken(serviceAccountKey)
    const gitHubAccessToken = await fs.promises.readFile('private/Elemento-Test-1-2RepoToken_finegrained.txt', 'utf8')

    const checkoutPath = `${os.tmpdir}/adminUtil.test/checkout`
    console.log('deployFilesPath', checkoutPath)
    await fs.promises.rm(checkoutPath, {force: true, recursive: true}).then( ()=> fs.promises.mkdir(checkoutPath, {recursive: true}))

    const moduleCache = new CloudStorageCache('deployCache')
    await t.test('deploy to hosting', async () => {
        await deployToHosting({
            gitRepoUrl: 'https://github.com/rileydog16/Elemento-Test-2',
            firebaseProject,
            checkoutPath, firebaseAccessToken: firebaseAccessToken, gitHubAccessToken, moduleCache})
    })
})