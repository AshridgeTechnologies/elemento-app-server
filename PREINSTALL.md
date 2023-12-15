<!-- 
This file provides your users an overview of your extension. All content is optional, but this is the recommended format. Your users will see the contents of this file when they run the `firebase ext:info` command.

Include any important functional details as well as a brief description for any additional setup required by the user (both pre- and post-installation).

Learn more about writing a PREINSTALL.md file in the docs:
https://firebase.google.com/docs/extensions/publishers/user-documentation#writing-preinstall
-->

# Elemento App Server

This extension provides hosting for apps created with the [Elemento](https://elemento.online) low code tool.

## What it does
It installs three Firebase functions that provide the following services in the Firebase project where it is installed:

### Admin server
This function deploys (publishes) Elemento projects from GitHub to the Hosting of the Firebase project.
The projects must have been created with the Elemento Studio and saved in GitHub

### App server
This function runs the Server Apps in the deployed Elemento project, for use by normal clients using the app.

### Preview server
This function runs preview versions of the Server Apps, for use by the Preview window in the Elemento Studio.  
It allows the Studio to immediately update the Server Apps after every change.

## Before installing
You will need to choose a password for the Preview server, which you will enter in the extension configuration.


# Billing
To install an extension, your project must be on the [Blaze (pay as you go) plan](https://firebase.google.com/pricing)

- This extension uses other Firebase and Google Cloud Platform services, which have associated charges if you exceed the service’s no-cost tier:
- Cloud Storage
- Cloud Functions (Node.js 18+ runtime. [See FAQs](https://firebase.google.com/support/faq#extensions-pricing))