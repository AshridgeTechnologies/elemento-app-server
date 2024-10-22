# Using this service

This service is designed to be used with the Elemento Studio, to support its functionality, and by deployed Elemento apps.

The Admin server and Preview server functionality are designed to be triggered by calls from the Elemento Studio.
The App server functionality is triggered by calls from Elemento client apps running in the end-user's browser.


# Using the service during development

If you are developing an Elemento Project that includes Server Apps, 
you will need to set up the Project to use this service to provide a preview of the Server App functionality.

Open the project in Elemento Studio, then open the Firebase tool (Tools menu -> Firebase).

In the Preview Settings box:
- Enter the Firebase Project Id
- Enter the Preview password that you set in the Editor during installation
- Click Save

If you forget the password or want to change it repeat the steps above.

# Deploying (publishing) a Project

When you are ready to deploy your Elemento Project, follow these steps:

Open the project in Elemento Studio, then open the Firebase tool (Tools menu -> Firebase).

Ensure you have saved the project to GitHub

In the Deploy box:
- Click the GitHub button to connect to GitHub if you are not already connected
- Click the Google button and connect with the Google account that you use to manage this Firebase Project
- Enter the URL of the GitHub project you are going to deploy from
- Enter the Firebase Project Id
- Click Deploy

Deployment will take a few seconds

You should then be able to click the AppURL link in the Deploy box to view the deployed app.
