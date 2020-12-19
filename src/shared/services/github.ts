const gh = async (query: string, variables: any = {}) => {
  try {
    const req = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `bearer ${process.env.GITHUB_TOKEN}`,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });
    const json = await req.json();

    return json;
  } catch (err) {
    throw new Error(err);
  }
};

export default gh;