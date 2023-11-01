import {google} from 'googleapis'
import {Credentials} from 'google-auth-library'

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