# Elemento App Server

This tool provides hosting for apps created with the [Elemento](https://elemento.online) low code tool.

## What it does
There are three functions that provide the following services in the Firebase project where it is installed:

### Admin server
Deploys (publishes) Elemento projects from GitHub to the Hosting of the Firebase project.
The projects must have been created with the Elemento Studio and saved in GitHub

### App server
Runs the Server Apps in the deployed Elemento project, for use by normal clients using the app.

### Preview server
Runs preview versions of the Server Apps, for use by the Preview window in the Elemento Studio.  
It allows the Studio to immediately update the Server Apps after every change.

# Billing
To install the app server, your project must be on the [Blaze (pay as you go) plan](https://firebase.google.com/pricing)

- The server uses other Firebase and Google Cloud Platform services, which have associated charges if you exceed the service’s no-cost tier:
- Cloud Storage
- Cloud Run 