import {test} from 'node:test'
//import {expect} from 'expect'
import {deployToHosting} from '../src/adminUtil'
import {google} from 'googleapis'
import {Credentials} from 'google-auth-library'
import * as fs from 'fs'
import * as os from 'os'

function getAccessToken(serviceAccountKey: any): Promise<string> {
    const SCOPES = [
        'https://www.googleapis.com/auth/firebase'
    ]

    return new Promise(function(resolve, reject) {
        const jwtClient = new google.auth.JWT(
            serviceAccountKey.client_email,
            undefined,
            serviceAccountKey.private_key,
            SCOPES
        );
        jwtClient.authorize(function(err: Error | null, tokens: Credentials | undefined) {
            if (err || !tokens?.access_token) {
                reject(err);
                return;
            }
            resolve(tokens.access_token);
        });
    });
}

const serviceAccountKey = JSON.parse(fs.readFileSync('private/hosted-apps-spike-1-firebase-adminsdk-mgxrg-b943093d1f.json', 'utf8'))



test('admin util', async (t) => {

    const googleAccessToken = await getAccessToken(serviceAccountKey)
    const gitHubAccessToken = await fs.promises.readFile('private/githubRabbits5RepoToken_finegrained.txt', 'utf8')

    const checkoutPath = `${os.tmpdir}/adminUtil.test/checkout`
    console.log('deployFilesPath', checkoutPath)
    await fs.promises.rm(checkoutPath, {force: true, recursive: true}).then( ()=> fs.promises.mkdir(checkoutPath, {recursive: true}))

    await t.test('deploy to hosting', async () => {
        await deployToHosting({
            username: 'rileydog16', repo: '-Beetle1-',
            firebaseProject: 'hosted-apps-spike-1',
            checkoutPath, googleAccessToken, gitHubAccessToken})
    })
})