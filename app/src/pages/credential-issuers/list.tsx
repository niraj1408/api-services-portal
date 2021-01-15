//import Item from './item'

import { styles } from '../../shared/styles/devportal.css';

import NameValue from '../../components/name-value';

function List({ data, state, refetch }) {
    switch (state) {
      case 'loading': {
        return <p>Loading...</p>;
      }
      case 'error': {
        return <p>Error!</p>;
      }
      case 'loaded': {
        if (!data) {
              return <p>Ooops, something went wrong!</p>
        }
        console.log(JSON.stringify(data, null, 4))
        return (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {data.allCredentialIssuers.map((item, index) => (
                <li style={styles.listItem}>
                    <NameValue name="Name" value={item.name} width="300px"/>
                    <NameValue name="Auth Method" value={item.authMethod} width="200px"/>
                    <NameValue name="Mode" value={item.mode} width="200px"/>
                    <NameValue name="Contact" value={item.createdBy.name} width="200px"/>
                    <NameValue name="Families Using" value={item.dataSetGroups.map(g => g.name)} width="200px"/>
                </li>
            ))}
          </ul>
        );
      }
    }
    return (<></>)
  }

  export default List