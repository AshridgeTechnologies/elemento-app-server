// @ts-ignore
import fs from 'fs'
import {getAccessToken} from './testUtil'

const getToken = async () => {
    const serviceAccountKey = JSON.parse(fs.readFileSync('private/elemento-hosting-test-firebase-adminsdk-7en27-5ef2e44a5b-2.json', 'utf8'))
    const firebaseAccessToken = await getAccessToken(serviceAccountKey)
    console.log(firebaseAccessToken)
}

getToken()
