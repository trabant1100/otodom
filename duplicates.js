const fs = require('node:fs/promises');
const blockhash = require('blockhash-core');
const workerpool = require('workerpool');
const { imageFromBuffer, getImageData } = require('@canvas/image');

const imgFolder = './images/';

async function getFileNames() {
	return await fs.readdir(imgFolder);
}

async function generateRefMap() {
	const pool = workerpool.pool('./calcHashWorker.js');
	const files = (await getFileNames()).filter(fname => /.webp$/.test(fname));
	const refMap = new Map();
	const calcHashes = [];

	for (let i = 0; i < files.length; i++) {
		calcHashes.push(pool.exec('calcHash', [i, `${imgFolder}${files[i]}`]));
	}
	const progress = setInterval(() => {
		const { pendingTasks, activeTasks } = pool.stats();
		const progress = files.length - pendingTasks - activeTasks;
		console.log(`${progress}/${files.length}`);
	}, 1000);
	const hashes = await Promise.all(calcHashes);
	clearInterval(progress);
	pool.terminate();
	
	for (const { imgHash, filename } of hashes) {
		let valueArray;
		if (refMap.has(imgHash)) {
			const existingPaths = refMap.get(imgHash);
			valueArray = [...existingPaths, filename];
		} else {
			valueArray = [filename];
		}
		refMap.set(imgHash, valueArray);
  	}
	return refMap;
}

async function getAuctionUrl(listingDir, auctionId) {
	const listings = (await fs.readdir(listingDir)).filter(fname => /\d\d.\d\d.\d{4}/.test(fname));
	for (const listing of listings) {
		try {
			const fullFilename = `${listingDir}/${listing}/${auctionId}.json`;
			await fs.access(fullFilename);
			const { url } = JSON.parse(await fs.readFile(fullFilename));
			return url;
		} catch(e) {

		}
	}
}

function equalSets(set1, set2) {
	if (set1.size != set2.size) {
		return false;
	}

	for (const item1 of set1) {
		if (!set2.has(item1)) {
			return false;
		}
	}

	for (const item2 of set2) {
		if (!set1.has(item2)) {
			return false;
		}
	}

	return true;
}

function intersectSets(set1, set2) {
	const res = new Set();
	for (const item1 of set1) {
		if (set2.has(item1)) {
			res.add(item1);
		}
	}

	return res;
}

function patchConfig(config, duplicates) {
	duplicates = duplicates.slice(0);
	const configDuplicates = config.report.relisted_urls;

	for (let i = duplicates.length - 1; i >= 0; i--) {
		const dup = duplicates[i];
		for (const configDup of configDuplicates) {
			if (intersectSets(new Set(dup), new Set(configDup)).size > 0) {
				console.log('Existing duplicates');
				console.log(dup);
				configDup.length = 0;
				configDup.push(...dup);
				duplicates.splice(i, 1);
			}
		}
	}

	for (const dup of duplicates) {
		console.log('Found new duplicates');
		console.log(dup);
		configDuplicates.push(dup);
	}
}

(async function() {
	console.log('Analyzing images');
	const config = JSON.parse(await fs.readFile('config.json'));
	const listingDir = config.listing.dir;
	let duplicates = [];

	const refMap = await generateRefMap();
	for (const [key, value] of refMap) {
	  	if (value.length > 1) {
	  		let ids = [];
	  		for (const val of value) {
	  			const auctionId = (val.match(/\d+(?=_\d+.webp$)/) ?? [])[0];
	  			ids.push(auctionId);
	  		}
	  		ids = [...new Set(ids)];
	  		if (ids.length > 1) {
	  			duplicates.push(ids);
	  		}
	  	}
  	}


  	duplicates = duplicates.reduce(
  		(acc, val) => {
  			const dup1 = new Set(val);
  			if (!acc.some(dup => equalSets(new Set(dup), dup1))) {
  				acc.push(val);
  			}
  			return acc;
  		}, []);

	duplicates = await Promise.all(duplicates.map(async dup => {
		return await Promise.all(dup.map(async (id) => await getAuctionUrl(listingDir, id)));
	}));
  	patchConfig(config, duplicates);

  	console.log('Writing config.json');
  	await fs.writeFile('config.json', JSON.stringify(config, null, 4));
})();