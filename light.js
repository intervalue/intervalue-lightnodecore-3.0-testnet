/*jslint node: true */
"use strict";
var async = require('async');
var storage = require('./storage.js');
var objectHash = require("./object_hash.js");
var db = require('./db.js');
var mutex = require('./mutex.js');
var constants = require("./constants.js");
var graph = require('./graph.js');
var validation = require('./validation.js');
var ValidationUtils = require("./validation_utils.js");
var parentComposer = require('./parent_composer.js');
var eventBus = require('./event_bus.js');
var device = require('./device.js');
var hashnethelper = require('./hashnethelper');
var _ = require("lodash");

//判断上次拉取/更新交易列表是否完成
var u_finished = true;
//交易记录列表
let tranList = null;
//钱包收款地址
let tranAddr = [];
//可用余额
let stable = 0;
//待确认余额
let pending = 0;

async function updateHistory(addresses) {
	//如果上次updateHistory还没完成，则返回，否则继续往下走
	if (!u_finished) {
		return;
	}
    //将u_finished设置为false，表示正在进行交易记录更新
    u_finished = false;
	//判断钱包是否切换了，如果是，则重新初始化局部全节点列表。
	if (device.walletChanged) {
		device.walletChanged = false;
		await hashnethelper.initialLocalfullnodeList();
		//初始化交易列表
		await iniTranList(addresses);
	}
	//存储此次交易记录的数组
	let trans = null;
	try {
		for (var address of addresses) {
			//从共识网拉取交易记录
			let result = await hashnethelper.getTransactionHistory(address);
			//如果交易记录不为空，需要加入到待处理的数组中。
			if (result != null) {
				if (trans == null) {
					trans = [];
				}
				if (result.length > 0) {
					trans = trans.concat(result);
				}
			}
		}
		console.log(JSON.stringify(trans));
		//如果为NULL，则表示访问共识网有问题，返回。
		if (trans == null) {
			return;
		}
		//如果交易记录长度为零，需要清空本地的交易记录。
		if (trans.length === 0) {
			await truncateTran(addresses);
		}
		else {
			//初始化交易列表
			await iniTranList(addresses);
			for (var tran of trans) {
				let my_tran = _.find(tranList, { id: tran.hash });
				//本地存在交易记录，状态是待确认，需要进行状态的更新。
				if (my_tran && tran.isStable == 1 && tran.isValid == 1 && my_tran.result == 'pending') {
					await updateTran(tran);
				}
				//本地存在交易记录，共识网判定交易非法，需要更新交易状态到本地
				else if (my_tran && tran.isStable == 1 && tran.isValid == 0 && my_tran.result != 'final-bad') {
					await badTran(tran);
				}
				//本地不存在此交易记录，需往本地插入交易记录
				else if (!my_tran && tran.isValid == 1) {
					await insertTran(tran);
				}
			}
		}
	}
	catch (e) {
		console.log(e.toString());
	}
	//此次交易记录更新完毕，重置标志位。
	finally { u_finished = true; }
}

//刷新本地交易记录列表
function refreshTranList(tran) {
	let my_tran = _.find(tranList, { id: tran.id });
	//如果交易记录存在
	if (my_tran) {
		//交易的接收方
		if (tranAddr.indexOf(tran.to)) {
			//更新余额和待确认金额
			if (my_tran.result != 'good' && tran.isValid) {
				stable += tran.amount;
				pending -= tran.amount;
			}
			else if (my_tran.result == 'good' && !tran.isValid) {
				stable -= tran.amount;
			}
		}
		//交易的发送方
		else {
			if (my_tran.result != 'final-bad' && !tran.isValid) {
				//更新余额和待确认金额
				stable += tran.amount;
				stable += tran.fee;
				pending -= tran.amount;
				pending -= tran.fee;
			}
		}
		//更新交易记录的状态
		my_tran.result = getResultFromTran(tran);
	}
	else {
		//如果本地不存在记录，需要插入新的记录到列表中
		my_tran = { id: tran.id, creation_date: tran.creation_date, amount: tran.amount, fee: tran.fee, addressFrom: tran.addressFrom, addressTo: tran.addressTo, result: getResultFromTran(tran) };
		//如果是交易的接收方
		if (tranAddr.indexOf(tran.to)) {
			//更新余额和待确认金额
			my_tran.action = 'received';
			switch (my_tran.result) {
				case 'pending':
					pending += tran.amount;
					break;
				case 'good':
					stable += tran.amount;
					break;
				case 'final-bad':
					my_tran.action = 'invalid';
					break;
			}
		}
		else {
			//交易的发送方
			my_tran.action = 'sent';
			switch (my_tran.result) {

				case 'pending':
					stable -= tran.amount;
					stable -= tran.fee;
					pending += tran.amount;
					pending += tran.fee;
					break;
				case 'good':
					stable -= tran.amount;
					stable -= tran.fee;
					break;
				case 'final-bad':
					my_tran.action = 'invalid';
					break;
			}
			//往列表中插入记录
			tranList.push(my_tran);
		}
	}
}
//通过交易的状态返回数据库中状态的值
function getResultFromTran(tran) {
	if (tran.isStable && tran.isValid) {
		return 'good';
	}
	else if (tran.isStable && !tran.isValid) {
		return 'final-bad';
	}
	else if (!tran.isStable) {
		return 'pending';
	}
}
//钱包启动后初始化余额、待确认、交易列表
async function iniTranList(addresses) {
	if (tranAddr == [] || tranAddr != addresses || !tranList) {
		tranAddr = addresses;
		//余额 = 收到 - 发送
		stable = parseInt(db.single("select (select ifnull(sum(amount),0) from transactions where addressTo in (?) and result = 'good') - \n\
			(select ifnull(sum(amount + fee),0) from transactions where addressFrom in (?) and (result = 'good' or result = 'pending')) as stable", addresses, addresses));
		//待确认
		pending = parseInt(db.single("select (select ifnull(sum(amount),0) from transactions where addressTo in (?) and result = 'pending') + \n\
			(select ifnull(sum(amount + fee),0) from transactions where addressFrom in (?) and result = 'pending') as pending", addresses, addresses));
		//交易列表
		tranList = await db.toList("select *,case when result = 'final-bad' then 'invalid' when addressFrom = ? then 'sent' else 'received' end as action \n\
		 from transactions where(addressFrom in (?) or addressTo in (?))", addresses[0], addresses, addresses);
	}
}
//将交易列表(包括数据库中的交易记录)清空，发生的主要场景是共识网重启后，之前的交易记录会清空，本地需要同步。
async function truncateTran(addresses) {
	await iniTranList(addresses);
	let count = tranList.length;
	let cmds = [];
	if (count > 0) {
		db.addCmd(cmds, "delete from transactions where addressFrom in (?) or addressTo in (?)", addresses, addresses);
		//用队列的方式更新数据库
		await mutex.lock(["write"], async function (unlock) {
			try {
				let b_result = await db.executeTrans(cmds);
				if (!b_result) {
					//清空列表
					tranList = [];
					//更新界面
					eventBus.emit('my_transactions_became_stable');
				}
			}
			catch (e) {
				console.log(e.toString());
			}
			finally {
				//解锁事务队列
				await unlock();
			}
		});
	}
}
//更新已有交易记录的状态
async function updateTran(tran) {
	let id = tran.hash;
	//用队列的方式更新数据库
	await mutex.lock(["write"], async function (unlock) {
		try {
			//更新数据库
			let u_result = await db.execute("update transactions set result = 'good' where id = ?", id);
			if (u_result.affectedRows) {
				//更新列表
				refreshTranList(tran);
				//更新界面
				eventBus.emit('my_transactions_became_stable');
			}
		}
		catch (e) {
			console.log(e.toString());
		}
		finally {
			//解锁事务队列
			await unlock();
		}
	});
}
//失败的交易
async function badTran(tran) {
	let id = tran.hash;
	let cmds = [];
	db.addCmd(cmds, "update transactions set result = 'final-bad' where id = ?", id);
	//用队列的方式更新数据库
	await mutex.lock(["write"], async function (unlock) {
		try {
			//更新数据库
			let b_result = await db.executeTrans(cmds);
			if (!b_result) {
				//更新列表
				refreshTranList(tran);
				//刷新界面
				eventBus.emit('my_transactions_became_stable');
			}
		}
		catch (e) {
			console.log(e.toString());
		}
		finally {
			//解锁事务队列
			await unlock();
		}
	});
}

//新增一条交易记录
async function insertTran(tran) {
	console.log("\nsaving unit:");
	console.log(JSON.stringify(tran));
	var cmds = [];
	var fields = "id, creation_date, amount, fee, addressFrom, addressTo, result";
	var values = "?,?,?,?,?,?,?";
	var params = [tran.hash, tran.time, tran.amount,tran.fee || 0, tran.fromAddress, tran.toAddress, getResultFromTran(tran)];
	db.addCmd(cmds, "INSERT INTO transactions (" + fields + ") VALUES (" + values + ")", ...params);
	//用队列的方式更新数据库
	await mutex.lock(["write"], async function (unlock) {
		try {
			//更新数据库
			let i_result = await db.executeTrans(cmds);
			if (!i_result) {
				//更新列表
				refreshTranList(tran);
				//刷新列表
				eventBus.emit('my_transactions_became_stable');
			}
		}
		catch (e) {
			console.log(e.toString());
		}
		finally {
			//解锁事务队列
			await unlock();
		}
	});
}


// fixes is_spent in case units were received out of order
function fixIsSpentFlag(onDone) {
	db.query(
		"SELECT outputs.unit, outputs.message_index, outputs.output_index \n\
		FROM outputs \n\
		JOIN inputs ON outputs.unit=inputs.src_unit AND outputs.message_index=inputs.src_message_index AND outputs.output_index=inputs.src_output_index \n\
		WHERE is_spent=0 AND type='transfer'",
		function (rows) {
			console.log(rows.length + " previous outputs appear to be spent");
			if (rows.length === 0)
				return onDone();
			var arrQueries = [];
			rows.forEach(function (row) {
				console.log('fixing is_spent for output', row);
				db.addQuery(arrQueries,
					"UPDATE outputs SET is_spent=1 WHERE unit=? AND message_index=? AND output_index=?", [row.unit, row.message_index, row.output_index]);
			});
			async.series(arrQueries, onDone);
		}
	);
}

function fixInputAddress(onDone) {
	db.query(
		"SELECT outputs.unit, outputs.message_index, outputs.output_index, outputs.address \n\
		FROM outputs \n\
		JOIN inputs ON outputs.unit=inputs.src_unit AND outputs.message_index=inputs.src_message_index AND outputs.output_index=inputs.src_output_index \n\
		WHERE inputs.address IS NULL AND type='transfer'",
		function (rows) {
			console.log(rows.length + " previous inputs appear to be without address");
			if (rows.length === 0)
				return onDone();
			var arrQueries = [];
			rows.forEach(function (row) {
				console.log('fixing input address for output', row);
				db.addQuery(arrQueries,
					"UPDATE inputs SET address=? WHERE src_unit=? AND src_message_index=? AND src_output_index=?",
					[row.address, row.unit, row.message_index, row.output_index]);
			});
			async.series(arrQueries, onDone);
		}
	);
}

function fixIsSpentFlagAndInputAddress(onDone) {
	fixIsSpentFlag(function () {
		fixInputAddress(onDone);
	});
}

function determineIfHaveUnstableJoints(arrAddresses, handleResult) {
	if (arrAddresses.length === 0)
		return handleResult(false);
	db.query(
		"SELECT DISTINCT unit, main_chain_index FROM outputs JOIN units USING(unit) \n\
		WHERE address IN(?) AND +sequence='good' AND is_stable=0 \n\
		UNION \n\
		SELECT DISTINCT unit, main_chain_index FROM unit_authors JOIN units USING(unit) \n\
		WHERE address IN(?) AND +sequence='good' AND is_stable=0 \n\
		LIMIT 1",
		[arrAddresses, arrAddresses],
		function (rows) {
			handleResult(rows.length > 0);
		}
	);
}

function emitStability(arrProvenUnits, onDone) {
	var strUnitList = arrProvenUnits.map(db.escape).join(', ');
	db.query(
		"SELECT unit FROM unit_authors JOIN my_addresses USING(address) WHERE unit IN(" + strUnitList + ") \n\
		UNION \n\
		SELECT unit FROM outputs JOIN my_addresses USING(address) WHERE unit IN("+ strUnitList + ") \n\
		UNION \n\
		SELECT unit FROM unit_authors JOIN shared_addresses ON address=shared_address WHERE unit IN("+ strUnitList + ") \n\
		UNION \n\
		SELECT unit FROM outputs JOIN shared_addresses ON address=shared_address WHERE unit IN("+ strUnitList + ")",
		function (rows) {
			onDone(rows.length > 0);
			if (rows.length > 0) {
				eventBus.emit('my_transactions_became_stable', rows.map(function (row) { return row.unit; }));
				rows.forEach(function (row) {
					eventBus.emit('my_stable-' + row.unit);
				});
			}
		}
	);
}


function prepareParentsAndLastBallAndWitnessListUnit(arrWitnesses, callbacks) {
	if (!ValidationUtils.isArrayOfLength(arrWitnesses, constants.COUNT_WITNESSES))
		return callbacks.ifError("wrong number of witnesses");
	storage.determineIfWitnessAddressDefinitionsHaveReferences(db, arrWitnesses, function (bWithReferences) {
		if (bWithReferences)
			return callbacks.ifError("some witnesses have references in their addresses");
		parentComposer.pickParentUnitsAndLastBall(
			db,
			arrWitnesses,
			function (err, arrParentUnits, last_stable_mc_ball, last_stable_mc_ball_unit, last_stable_mc_ball_mci) {
				if (err)
					return callbacks.ifError("unable to find parents: " + err);
				var objResponse = {
					parent_units: arrParentUnits,
					last_stable_mc_ball: last_stable_mc_ball,
					last_stable_mc_ball_unit: last_stable_mc_ball_unit,
					last_stable_mc_ball_mci: last_stable_mc_ball_mci
				};
				storage.findWitnessListUnit(db, arrWitnesses, last_stable_mc_ball_mci, function (witness_list_unit) {
					if (witness_list_unit)
						objResponse.witness_list_unit = witness_list_unit;
					callbacks.ifOk(objResponse);
				});
			}
		);
	});
}

// arrUnits sorted in reverse chronological order
function prepareLinkProofs(arrUnits, callbacks) {
	if (!ValidationUtils.isNonemptyArray(arrUnits))
		return callbacks.ifError("no units array");
	if (arrUnits.length === 1)
		return callbacks.ifError("chain of one element");
	mutex.lock(['prepareLinkProofs'], function (unlock) {
		var start_ts = Date.now();
		var arrChain = [];
		async.forEachOfSeries(
			arrUnits,
			function (unit, i, cb) {
				if (i === 0)
					return cb();
				createLinkProof(arrUnits[i - 1], arrUnits[i], arrChain, cb);
			},
			function (err) {
				console.log("prepareLinkProofs for units " + arrUnits.join(', ') + " took " + (Date.now() - start_ts) + 'ms, err=' + err);
				err ? callbacks.ifError(err) : callbacks.ifOk(arrChain);
				unlock();
			}
		);
	});
}

// adds later unit
// earlier unit is not included in the chain
function createLinkProof(later_unit, earlier_unit, arrChain, cb) {
	storage.readJoint(db, later_unit, {
		ifNotFound: function () {
			cb("later unit not found");
		},
		ifFound: function (objLaterJoint) {
			var later_mci = objLaterJoint.unit.main_chain_index;
			arrChain.push(objLaterJoint);
			storage.readUnitProps(db, objLaterJoint.unit.last_ball_unit, function (objLaterLastBallUnitProps) {
				var later_lb_mci = objLaterLastBallUnitProps.main_chain_index;
				storage.readJoint(db, earlier_unit, {
					ifNotFound: function () {
						cb("earlier unit not found");
					},
					ifFound: function (objEarlierJoint) {
						var earlier_mci = objEarlierJoint.unit.main_chain_index;
						var earlier_unit = objEarlierJoint.unit.unit;
						if (later_mci < earlier_mci)
							return cb("not included");
						if (later_lb_mci >= earlier_mci) { // was spent when confirmed
							// includes the ball of earlier unit
							buildProofChain(later_lb_mci + 1, earlier_mci, earlier_unit, arrChain, function () {
								cb();
							});
						}
						else { // the output was unconfirmed when spent
							graph.determineIfIncluded(db, earlier_unit, [later_unit], function (bIncluded) {
								if (!bIncluded)
									return cb("not included");
								buildPath(objLaterJoint, objEarlierJoint, arrChain, function () {
									cb();
								});
							});
						}
					}
				});
			});
		}
	});
}

// build parent path from later unit to earlier unit and add all joints along the path into arrChain
// arrChain will include later unit but not include earlier unit
// assuming arrChain already includes later unit
function buildPath(objLaterJoint, objEarlierJoint, arrChain, onDone) {

	function addJoint(unit, onAdded) {
		storage.readJoint(db, unit, {
			ifNotFound: function () {
				throw Error("unit not found?");
			},
			ifFound: function (objJoint) {
				arrChain.push(objJoint);
				onAdded(objJoint);
			}
		});
	}

	function goUp(objChildJoint) {
		db.query(
			"SELECT parent.unit, parent.main_chain_index FROM units AS child JOIN units AS parent ON child.best_parent_unit=parent.unit \n\
			WHERE child.unit=?",
			[objChildJoint.unit.unit],
			function (rows) {
				if (rows.length !== 1)
					throw Error("goUp not 1 parent");
				if (rows[0].main_chain_index < objEarlierJoint.unit.main_chain_index) // jumped over the target
					return buildPathToEarlierUnit(objChildJoint);
				addJoint(rows[0].unit, function (objJoint) {
					(objJoint.unit.main_chain_index === objEarlierJoint.unit.main_chain_index) ? buildPathToEarlierUnit(objJoint) : goUp(objJoint);
				});
			}
		);
	}

	function buildPathToEarlierUnit(objJoint) {
		db.query(
			"SELECT unit FROM parenthoods JOIN units ON parent_unit=unit \n\
			WHERE child_unit=? AND main_chain_index=?",
			[objJoint.unit.unit, objJoint.unit.main_chain_index],
			function (rows) {
				if (rows.length === 0)
					throw Error("no parents with same mci?");
				var arrParentUnits = rows.map(function (row) { return row.unit });
				if (arrParentUnits.indexOf(objEarlierJoint.unit.unit) >= 0)
					return onDone();
				if (arrParentUnits.length === 1)
					return addJoint(arrParentUnits[0], buildPathToEarlierUnit);
				// find any parent that includes earlier unit
				async.eachSeries(
					arrParentUnits,
					function (unit, cb) {
						graph.determineIfIncluded(db, objEarlierJoint.unit.unit, [unit], function (bIncluded) {
							if (!bIncluded)
								return cb(); // try next
							cb(unit); // abort the eachSeries
						});
					},
					function (unit) {
						if (!unit)
							throw Error("none of the parents includes earlier unit");
						addJoint(unit, buildPathToEarlierUnit);
					}
				);
			}
		);
	}

	if (objLaterJoint.unit.unit === objEarlierJoint.unit.unit)
		return onDone();
	(objLaterJoint.unit.main_chain_index === objEarlierJoint.unit.main_chain_index) ? buildPathToEarlierUnit(objLaterJoint) : goUp(objLaterJoint);
}

function processLinkProofs(arrUnits, arrChain, callbacks) {
	// check first element
	var objFirstJoint = arrChain[0];
	if (!objFirstJoint || !objFirstJoint.unit || objFirstJoint.unit.unit !== arrUnits[0])
		return callbacks.ifError("unexpected 1st element");
	var assocKnownUnits = {};
	var assocKnownBalls = {};
	assocKnownUnits[arrUnits[0]] = true;
	for (var i = 0; i < arrChain.length; i++) {
		var objElement = arrChain[i];
		if (objElement.unit && objElement.unit.unit) {
			var objJoint = objElement;
			var objUnit = objJoint.unit;
			var unit = objUnit.unit;
			if (!assocKnownUnits[unit])
				return callbacks.ifError("unknown unit " + unit);
			if (!validation.hasValidHashes(objJoint))
				return callbacks.ifError("invalid hash of unit " + unit);
			assocKnownBalls[objUnit.last_ball] = true;
			assocKnownUnits[objUnit.last_ball_unit] = true;
			objUnit.parent_units.forEach(function (parent_unit) {
				assocKnownUnits[parent_unit] = true;
			});
		}
		else if (objElement.unit && objElement.ball) {
			var objBall = objElement;
			if (!assocKnownBalls[objBall.ball])
				return callbacks.ifError("unknown ball " + objBall.ball);
			if (objBall.ball !== objectHash.getBallHash(objBall.unit, objBall.parent_balls, objBall.skiplist_balls, objBall.is_nonserial))
				return callbacks.ifError("invalid ball hash");
			objBall.parent_balls.forEach(function (parent_ball) {
				assocKnownBalls[parent_ball] = true;
			});
			if (objBall.skiplist_balls)
				objBall.skiplist_balls.forEach(function (skiplist_ball) {
					assocKnownBalls[skiplist_ball] = true;
				});
			assocKnownUnits[objBall.unit] = true;
		}
		else
			return callbacks.ifError("unrecognized chain element");
	}
	// so, the chain is valid, now check that we can find the requested units in the chain
	for (var i = 1; i < arrUnits.length; i++) // skipped first unit which was already checked
		if (!assocKnownUnits[arrUnits[i]])
			return callbacks.ifError("unit " + arrUnits[i] + " not found in the chain");
	callbacks.ifOk();
}

exports.prepareHistory = prepareHistory;
exports.processHistory = processHistory;
exports.prepareLinkProofs = prepareLinkProofs;
exports.processLinkProofs = processLinkProofs;
exports.determineIfHaveUnstableJoints = determineIfHaveUnstableJoints;
exports.prepareParentsAndLastBallAndWitnessListUnit = prepareParentsAndLastBallAndWitnessListUnit;
exports.updateHistory = updateHistory;
exports.stable = stable;
exports.pending = pending;
exports.refreshTranList = refreshTranList;
exports.tranList = tranList;
