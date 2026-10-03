const sendResetPassEmail = async (opts: { to: string; url: string; token: string }) => {
    console.log(`Sending password reset email to ${opts.to} with URL: ${opts.url} and token: ${opts.token}`); //for now!!!
}

export default sendResetPassEmail;