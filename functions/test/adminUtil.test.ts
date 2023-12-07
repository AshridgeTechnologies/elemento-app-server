import {test} from 'node:test'
import {deployToHosting} from '../src/adminUtil'
import * as fs from 'fs'
import * as os from 'os'
import {getAccessToken} from './testUtil'
// @ts-ignore
import admin from 'firebase-admin'
import {CloudStorageCache} from '../src/CloudStorageCache'

const firebaseProject = 'hosted-apps-spike-1'
const bucketName = `${firebaseProject}.appspot.com`
const serviceAccountKey = JSON.parse(fs.readFileSync('private/hosted-apps-spike-1-firebase-adminsdk-mgxrg-b943093d1f.json', 'utf8'))
admin.initializeApp({credential: admin.credential.cert(serviceAccountKey), storageBucket: bucketName})

test('admin util', async (t) => {

    const firebaseAccessToken = await getAccessToken(serviceAccountKey)
    const gitHubAccessToken = await fs.promises.readFile('private/Elemento-Test-1-2RepoToken_finegrained.txt', 'utf8')

    const checkoutPath = `${os.tmpdir}/adminUtil.test/checkout`
    console.log('deployFilesPath', checkoutPath)
    await fs.promises.rm(checkoutPath, {force: true, recursive: true}).then( ()=> fs.promises.mkdir(checkoutPath, {recursive: true}))

    const moduleCache = new CloudStorageCache()
    await t.test('deploy to hosting', async () => {
        await deployToHosting({
            gitRepoUrl: 'https://github.com/rileydog16/Elemento-Test-2',
            firebaseProject,
            checkoutPath, firebaseAccessToken: firebaseAccessToken, gitHubAccessToken, moduleCache})
    })
})