// @ts-ignore
import fs from 'fs'
import {getAccessToken} from './testUtil'

const getToken = async () => {
    const serviceAccountKey = JSON.parse(fs.readFileSync('private/stone-frog-world-firebase-adminsdk-ac9t4-e864115f83.json', 'utf8'))
    const firebaseAccessToken = await getAccessToken(serviceAccountKey)
    console.log(firebaseAccessToken)
}

getToken()
