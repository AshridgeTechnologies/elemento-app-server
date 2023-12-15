# Using this extension

This extension is designed to be used with the Elemento Studio, to support its functionality, and by deployed Elemento apps.

The Admin server and Preview server functions are designed to be triggered by calls from the Elemento Studio.
The App server function is triggered by calls from Elemento client apps running in the end-user's browser.


# Using the extension during development

If you are developing an Elemento Project that includes Server Apps, 
you will need to set up the Project to use this extension to provide a preview of the Server App functionality.

Open the project in Elemento Studio, then open the Firebase tool (Tools menu -> Firebase).

In the Preview Settings box:
- Enter the Firebase Project Id
- Enter the Preview password that you set in the Editor during installation
- Click Save

If you forget the password or want to change it (recommended at frequent intervals), 
use the Extension Configuration panel in the Firebase Console and click `Reconfigure extension` to update the password.

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



# Using the extension

When triggered by an HTTP request, this extension responds with the following specified greeting: "${param:GREETING} World from ${param:EXT_INSTANCE_ID}".

To learn more about HTTP functions, visit the [functions documentation](https://firebase.google.com/docs/functions/http-events).

# Monitoring

As a best practice, you can [monitor the activity](https://firebase.google.com/docs/extensions/manage-installed-extensions#monitor) of your installed extension, including checks on its health, usage, and logs.
