import {Request} from 'express'
import {expressAdminApp} from './expressUtils.js'
import path from 'path'
import {deployToHosting} from './adminUtil'

const checkData = (value: string | undefined, name: string) => {
    if (!value) {
        throw new Error(`${name} not supplied`)
    }
}

const createDeployHandler = ({localFilePath}: {localFilePath: string}) =>
    async (req: Request, res: any, next: (err?: any) => void) => {
        console.log('deploy handler', req.url)
        try {
            const {username, repo, firebaseProject} = req.body
            const googleAccessToken = req.get('X-Google-Access-Token')
            const gitHubAccessToken = req.get('X-GitHub-Access-Token')

            checkData(googleAccessToken, 'Google access token')
            checkData(gitHubAccessToken, 'GitHub access token')
            checkData(username, 'GitHub username')
            checkData(repo, 'GitHub repo')
            checkData(firebaseProject, 'Firebase Project')

            const deployTag = new Date().toISOString().substring(0, 19)
            const checkoutPath = path.join(localFilePath, 'deploy', deployTag)
            const releaseResult = await deployToHosting({username, repo, firebaseProject, checkoutPath,
                googleAccessToken: googleAccessToken!, gitHubAccessToken: gitHubAccessToken!})
            res.send(releaseResult)
        } catch (err) {
            next(err)
        }
    }

export default function createAdminServer({localFilePath}: {localFilePath: string}) {
    console.log('createAdminServer', )
    const deployHandler = createDeployHandler({localFilePath})
    return expressAdminApp(deployHandler)
}
