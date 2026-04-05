#include <vector>
using namespace std;

vector<int> findCommon(vector<int> a, vector<int> b) {
    vector<int> result;

    for (int i = 0; i < a.size(); i++) {
        for (int j = 0; j < b.size(); j++) {
            if (a[i] == b[j]) {

                bool exists = false;
                for (int k = 0; k < result.size(); k++) {
                    if (result[k] == a[i]) {
                        exists = true;
                        break;
                    }
                }

                if (!exists) {
                    result.push_back(a[i]);
                }
            }
        }
    }

    return result;
}