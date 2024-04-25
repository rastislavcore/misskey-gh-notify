import * as http from 'http';
import { EventEmitter } from 'events';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import request from 'request';
import crypto = require('crypto');
import { Netmask } from 'netmask';

import config from '../config.json';

const handler = new EventEmitter();

// GitHub's IP range for webhooks: https://api.github.com/meta (section hooks)
const allowedIPBlocks = [
	new Netmask('192.30.252.0/22'),
	new Netmask('185.199.108.0/22'),
	new Netmask('140.82.112.0/20'),
	new Netmask('143.55.64.0/20'),
];

// Function to post a note to Misskey
const post = async (text: string, home = true) => {
	request.post(config.instance + '/api/notes/create', {
		json: {
			i: config.i,
			text,
			visibility: home ? 'home' : 'public',
			noExtractMentions: true,
			noExtractHashtags: true
		}
	});
};

const app = new Koa();
app.use(bodyParser());

const secret = config.hookSecret;

const router = new Router();

// Middleware to validate the IP address of the request
app.use((ctx, next) => {
	const ip = ctx.ip;
	const isAllowed = allowedIPBlocks.some(block => block.contains(ip));
	if (isAllowed) {
		return next();
	} else {
		ctx.status = 403;
		ctx.body = 'Access denied';
		return Promise.resolve();
	}
});

// Endpoint to receive GitHub webhooks
router.post('/github', ctx => {
	const body = JSON.stringify(ctx.request.body);
	const hash = crypto.createHmac('sha1', secret).update(body).digest('hex');
	const githubSignature = ctx.headers['x-hub-signature'];

	// Ensure it's a string (as expected) and not undefined
	if (typeof githubSignature === 'string') {
		const sig1 = Buffer.from(githubSignature);
		const sig2 = Buffer.from(`sha1=${hash}`);

		// Compare signatures to verify the request
		if (sig1.equals(sig2)) {
			let ghHeader = ctx.headers['x-github-event'] as string;
			handler.emit(ghHeader, ctx.request.body);
			ctx.status = 204;
		} else {
			ctx.status = 400;
			ctx.body = 'Invalid GitHub signature';
		}
	} else {
		ctx.status = 400;
		ctx.body = 'Invalid or missing GitHub signature';
	}
});

app.use(router.routes());

const server = http.createServer(app.callback());

server.listen(config.port);

if (config.hooks.status) handler.on('status', event => {
	const state = event.state;
	switch (state) {
		case 'error':
		case 'failure':
			const commit = event.commit;
			const parent = commit.parents[0];

			request({
				url: `${parent.url}/statuses`,
				proxy: config.proxy,
				headers: {
					'User-Agent': 'misskey'
				}
			}, (err, res, body) => {
				if (err) {
					console.error(err);
					return;
				}
				try {
					const parentStatuses = JSON.parse(body);
					const parentState = parentStatuses[0]?.state;
					const stillFailed = parentState === 'failure' || parentState === 'error';
					if (stillFailed) {
						post(`⚠️ **BUILD STILL FAILED** ⚠️: [${commit.commit.message}](${commit.html_url})`);
					} else {
						post(`🚨 **BUILD FAILED** 🚨: [${commit.commit.message}](${commit.html_url})`);
					}
				} catch (parseError) {
					console.error('Error parsing JSON:', parseError);
				}
			});
			break;
	}
});


if (config.hooks.push) handler.on('push', event => {
	const ref = event.ref;
	switch (ref) {
		case 'refs/heads/develop':
			const pusher = event.pusher;
			const compare = event.compare;
			const commits: any[] = event.commits;
			post([
				`🆕 Pushed by **${pusher.name}** with ?[${commits.length} commit${commits.length > 1 ? 's' : ''}](${compare}):`,
				commits.reverse().map(commit => `・[?[${commit.id.substr(0, 7)}](${commit.url})] ${commit.message.split('\n')[0]}`).join('\n'),
			].join('\n'));
			break;
	}
});

if (config.hooks.issues) handler.on('issues', event => {
	const issue = event.issue;
	const action = event.action;
	let title: string;
	switch (action) {
		case 'opened': title = `💥 Issue opened`; break;
		case 'closed': title = `💮 Issue closed`; break;
		case 'reopened': title = `🔥 Issue reopened`; break;
		default: return;
	}
	post(`${title}: #${issue.number} "${issue.title}"\n${issue.html_url}`);
});

if (config.hooks.issue_comment) handler.on('issue_comment', event => {
	const issue = event.issue;
	const comment = event.comment;
	const action = event.action;
	let text: string;
	switch (action) {
		case 'created': text = `💬 Commented on "${issue.title}": ${comment.user.login} "<plain>${comment.body}</plain>"\n${comment.html_url}`; break;
		default: return;
	}
	post(text);
});

if (config.hooks.release) handler.on('release', event => {
	const action = event.action;
	const release = event.release;
	let text: string;
	switch (action) {
		case 'published': text = `🎁 **NEW RELEASE**: [${release.tag_name}](${release.html_url}) is out. Enjoy!`; break;
		default: return;
	}
	post(text);
});

if (config.hooks.watch) handler.on('watch', event => {
	const sender = event.sender;
	post(`$[spin ⭐️] Starred by ?[**${sender.login}**](${sender.html_url})`, false);
});

if (config.hooks.fork) handler.on('fork', event => {
	const sender = event.sender;
	const repo = event.forkee;
	post(`$[spin.y 🍴] ?[Forked](${repo.html_url}) by ?[**${sender.login}**](${sender.html_url})`);
});

if (config.hooks.pull_request) handler.on('pull_request', event => {
	const pr = event.pull_request;
	const action = event.action;
	let text: string;
	switch (action) {
		case 'opened': text = `📦 New Pull Request: "${pr.title}"\n${pr.html_url}`; break;
		case 'reopened': text = `🗿 Pull Request Reopened: "${pr.title}"\n${pr.html_url}`; break;
		case 'closed':
			text = pr.merged
				? `💯 Pull Request Merged!: "${pr.title}"\n${pr.html_url}`
				: `🚫 Pull Request Closed: "${pr.title}"\n${pr.html_url}`;
			break;
		default: return;
	}
	post(text);
});

if (config.hooks.pull_request_review_comment) handler.on('pull_request_review_comment', event => {
	const pr = event.pull_request;
	const comment = event.comment;
	const action = event.action;
	let text: string;
	switch (action) {
		case 'created': text = `💬 Review commented on "${pr.title}": ${comment.user.login} "<plain>${comment.body}</plain>"\n${comment.html_url}`; break;
		default: return;
	}
	post(text);
});

if (config.hooks.pull_request_review) handler.on('pull_request_review', event => {
	const pr = event.pull_request;
	const review = event.review;
	if (review.body === undefined || review.body === null || review.body.length <= 0) return;

	const action = event.action;
	let text: string;
	switch (action) {
		case 'submitted': text = `👀 Review submitted: "${pr.title}": ${review.user.login} "<plain>${review.body}</plain>"\n${review.html_url}`; break;
		default: return;
	}
	post(text);
});

if (config.hooks.discussion) handler.on('discussion', event => {
	const discussion = event.discussion;
	const action = event.action;
	let title: string;
	let url: string;
	switch (action) {
		case 'created':
			title = `💭 Discussion opened`;
			url = discussion.html_url;
			break;
		case 'closed':
			title = `💮 Discussion closed`;
			url = discussion.html_url;
			break;
		case 'reopened':
			title = `🔥 Discussion reopened`;
			url = discussion.html_url;
			break;
		case 'answered':
			title = `✅ Discussion marked answer`;
			url = discussion.answer_html_url;
			break;
		default: return;
	}
	post(`${title}: #${discussion.number} "${discussion.title}"\n${url}`);
});

if (config.hooks.discussion_comment) handler.on('discussion_comment', event => {
	const discussion = event.discussion;
	const comment = event.comment;
	const action = event.action;
	let text: string;
	switch (action) {
		case 'created': text = `💬 Commented on "${discussion.title}": ${comment.user.login} "<plain>${comment.body}</plain>"\n${comment.html_url}`; break;
		default: return;
	}
	post(text);
});

console.log("Service is running on port " + config.port);
