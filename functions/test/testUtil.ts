import {google} from 'googleapis'
import {Credentials} from 'google-auth-library'
import * as os from 'os'
import * as fs from 'fs'

export function getAccessToken(serviceAccountKey: any): Promise<string> {
    const SCOPES = [
        'https://www.googleapis.com/auth/firebase'
    ]

    return new Promise(function (resolve, reject) {
        const jwtClient = new google.auth.JWT(
            serviceAccountKey.client_email,
            undefined,
            serviceAccountKey.private_key,
            SCOPES
        );
        jwtClient.authorize(function (err: Error | null, tokens: Credentials | undefined) {
            if (err || !tokens?.access_token) {
                reject(err);
                return;
            }
            resolve(tokens.access_token);
        });
    });
}

export const clearDirectory = (path: string) => fs.promises.rm(path, {force: true, recursive: true}).then(() => fs.promises.mkdir(path))

export const wait = (time: number): Promise<void> => new Promise(resolve => setTimeout(resolve, time))
export const serverAppCode = `import * as serverRuntime from './serverRuntime.cjs'
const {globalFunctions} = serverRuntime
const {types} = serverRuntime

const {Sum, Sub} = globalFunctions
const {ChoiceType, DateType, ListType, NumberType, RecordType, TextType, TrueFalseType, Rule} = types

// time

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

async function Difference(x, y) {
    return //Differencecomment Sub(x, y)
}

async function HideMe(where) {
    return where + ' - there'
}

return {
    Plus: {func: Plus, update: false, argNames: ['a', 'b']},
    BlowUp: {func: BlowUp, update: false, argNames: ['c', 'd']},
    Total: {func: Total, update: false, argNames: ['x', 'y', 'z']},
    Difference: {func: Difference, update: false, argNames: ['x', 'y']}
}
}

export default ServerApp1`
let dirSeq = 0

export async function newTestDir() {
    const localFilePath = `${os.tmpdir()}/adminServer.test.${++dirSeq}`
    await fs.promises.rm(localFilePath, {force: true, recursive: true}).then(() => fs.promises.mkdir(localFilePath, {recursive: true}))
    return localFilePath
}