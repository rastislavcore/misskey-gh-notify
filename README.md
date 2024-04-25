# Misskey GH Notifier

GitHub notifier for Misskey, designed to post notifications to Misskey based on GitHub webhook events.

## Setup

### Requirements

- Node.js
- npm or yarn

### Installation

Clone the repository and install dependencies:

```bash
git clone https://yourrepository.com/misskey-gh-notifier.git
cd misskey-gh-notifier
npm install
```

### Configuration

Create a file named config.json in the root directory. Fill it with the necessary details as described below.

#### Configuring GitHub Webhooks

1. Go to the settings of your repo -> Webhooks -> Add Webhook
1. For Payload URL, use the URL or IP where you'll be hosting the bot, followed by `/github`
1. Select application/json for content type
1. Generate a random string of characters (~25 chars) for the Secret and place it under `hookSecret` in `config.json`.

#### Configuring Misskey Bot

1. Visit a bot-friendly Misskey instance and create a new account. Ensure to mark the account as a bot.
1. In the account profile, select the 3 dots -> Edit Profile -> API -> Generate Token
1. Place the generated token under `i` in `config.json`.

#### Example config.json

```json
{
  "port": 8080,
  "hookSecret": "your_random_string",
  "i": "your_misskey_api_token",
  "instance": "https://your.misskey.instance",
  "proxy": null,
  "hooks": {
    "status": true,
    "push": true,
    // Additional hooks...
  }
}
```

### Script Usage

To start the server, run:

```bash
npm run build  // Compiles TypeScript to JavaScript
npm start      // Starts the server
```

The service will listen for incoming GitHub webhooks and post notifications to the specified Misskey instance based on the events and the configuration specified in `config.json`.

### Development

#### Adding New Hooks

To handle additional GitHub events, expand the event handlers in the main script. Example:

```typescript
handler.on('new_event', event => {
  // Logic for handling new event
});
```

#### Package Dependencies

Ensure all dependencies are installed as specified in `package.json`. If modifications are made or new dependencies are needed, update `package.json` accordingly.

#### Troubleshooting

- Ensure all environment variables and configurations are correctly set.
- Check the server's network and firewall settings if GitHub webhooks are not reaching your server.

### Contributing

Contributions to the project are welcome. Please fork the repository and submit a pull request.
